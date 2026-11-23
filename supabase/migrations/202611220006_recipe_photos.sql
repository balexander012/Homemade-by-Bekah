-- Recipe photo library. Photos belong to the recipe, not to a version, so editing photos never
-- creates an ingredient or instruction revision. Files live in the private baking-photos bucket
-- under <workspace>/recipes/<recipe>/.

create table public.recipe_photos (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces,
  recipe_id uuid not null,
  path text not null check (path ~ '^[0-9a-f-]{36}/recipes/[0-9a-f-]{36}/[^/]+$'),
  card_path text not null check (card_path ~ '^[0-9a-f-]{36}/recipes/[0-9a-f-]{36}/[^/]+$'),
  thumb_path text not null check (thumb_path ~ '^[0-9a-f-]{36}/recipes/[0-9a-f-]{36}/[^/]+$'),
  is_primary boolean not null default false,
  position integer not null default 0 check (position >= 0),
  caption text not null default '' check (length(caption) <= 300),
  original_filename text not null default '' check (length(original_filename) <= 255),
  width integer not null check (width between 1 and 20000),
  height integer not null check (height between 1 and 20000),
  content_type text not null check (content_type in ('image/webp','image/jpeg')),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  source text not null default 'app' check (source in ('app','chatgpt')),
  crop jsonb not null default '{"x":0.5,"y":0.5,"zoom":1,"rotation":0}' check (jsonb_typeof(crop) = 'object'),
  -- "staged": bytes sent by the ChatGPT inbox wait in baking_import.photo_staging until a signed-in
  -- device moves them into Storage. "stored": the files are in Storage.
  state text not null default 'stored' check (state in ('staged','stored')),
  created_at timestamptz not null default now(),
  foreign key (workspace_id, recipe_id) references public.recipes (workspace_id, id),
  check (path like workspace_id::text || '/recipes/' || recipe_id::text || '/%'),
  check (card_path like workspace_id::text || '/recipes/' || recipe_id::text || '/%'),
  check (thumb_path like workspace_id::text || '/recipes/' || recipe_id::text || '/%')
);
create unique index recipe_photos_one_primary on public.recipe_photos (workspace_id, recipe_id) where is_primary;
create unique index recipe_photos_no_duplicates on public.recipe_photos (workspace_id, recipe_id, content_hash);
create index on public.recipe_photos (workspace_id, recipe_id, position);

-- Storage objects to remove after a replacement or deletion that a signed-in device has not cleaned up yet.
create table public.recipe_photo_trash (
  path text primary key check (path ~ '^[0-9a-f-]{36}/recipes/'),
  workspace_id uuid not null references public.workspaces,
  check (path like workspace_id::text || '/%')
);

alter table public.recipe_photos enable row level security;
alter table public.recipe_photo_trash enable row level security;
revoke all on public.recipe_photos, public.recipe_photo_trash from public, anon, authenticated;
grant select, insert, delete on public.recipe_photos to authenticated;
grant update (is_primary, position, caption, path, card_path, thumb_path, width, height, content_type, crop, content_hash, original_filename) on public.recipe_photos to authenticated;
grant select, insert, delete on public.recipe_photo_trash to authenticated;

-- Members of the workspace manage its photos. Integration (OAuth) clients may only read.
create policy member_read on public.recipe_photos for select to authenticated using (public.is_baking_member(workspace_id));
create policy member_write on public.recipe_photos for insert to authenticated
  with check (public.is_baking_member(workspace_id) and (auth.jwt() ->> 'client_id') is null and source = 'app' and state = 'stored');
create policy member_update on public.recipe_photos for update to authenticated
  using (public.is_baking_member(workspace_id) and (auth.jwt() ->> 'client_id') is null)
  with check (public.is_baking_member(workspace_id));
create policy member_delete on public.recipe_photos for delete to authenticated
  using (public.is_baking_member(workspace_id) and (auth.jwt() ->> 'client_id') is null);
create policy member_trash on public.recipe_photo_trash for all to authenticated
  using (public.is_baking_member(workspace_id) and (auth.jwt() ->> 'client_id') is null)
  with check (public.is_baking_member(workspace_id) and (auth.jwt() ->> 'client_id') is null);

-- Removing or replacing a photo requires deleting its files.
create policy photos_delete on storage.objects for delete to authenticated using (
  bucket_id = 'baking-photos' and (auth.jwt() ->> 'client_id') is null and
  public.is_baking_member((case when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    then (storage.foldername(name))[1] end)::uuid)
);

-- One main photo per recipe, switched in a single statement.
create function public.set_recipe_primary_photo(photo uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare target public.recipe_photos;
begin
  select * into target from public.recipe_photos where id = photo;
  if not found then raise exception 'Photo not found' using errcode = 'P0002'; end if;
  update public.recipe_photos set is_primary = false
    where workspace_id = target.workspace_id and recipe_id = target.recipe_id and is_primary and id <> photo;
  update public.recipe_photos set is_primary = true where id = photo;
end;
$$;
revoke all on function public.set_recipe_primary_photo(uuid) from public, anon;
grant execute on function public.set_recipe_primary_photo(uuid) to authenticated;

-- Bytes from the ChatGPT inbox wait here until a signed-in device moves them into Storage.
create table baking_import.photo_staging (
  photo_id uuid primary key references public.recipe_photos on delete cascade,
  full_image bytea not null check (octet_length(full_image) <= 4194304),
  card_image bytea not null check (octet_length(card_image) <= 4194304),
  thumb_image bytea not null check (octet_length(thumb_image) <= 1048576)
);
create table baking_import.photo_receipts (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces,
  payload jsonb not null,
  status text not null check (status in ('added','already_exists')),
  photo_id uuid,
  recipe_id uuid not null,
  commit_sha text not null check (commit_sha ~ '^[0-9a-f]{40}$'),
  received_at timestamptz not null default now()
);
alter table baking_import.photo_staging enable row level security;
alter table baking_import.photo_receipts enable row level security;

-- A signed-in member reads staged bytes to show or store them.
create function public.read_staged_recipe_photo(photo uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare row_ public.recipe_photos; staged baking_import.photo_staging;
begin
  select * into row_ from public.recipe_photos where id = photo;
  if not found or auth.uid() is null or not public.is_baking_member(row_.workspace_id) then
    raise exception 'Workspace access required' using errcode = '42501';
  end if;
  select * into staged from baking_import.photo_staging where photo_id = photo;
  if not found then return null; end if;
  return jsonb_build_object('full', encode(staged.full_image,'base64'), 'card', encode(staged.card_image,'base64'),
    'thumb', encode(staged.thumb_image,'base64'));
end;
$$;
create function public.finish_staged_recipe_photo(photo uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare row_ public.recipe_photos;
begin
  select * into row_ from public.recipe_photos where id = photo for update;
  if not found or auth.uid() is null or (auth.jwt() ->> 'client_id') is not null or not public.is_baking_member(row_.workspace_id) then
    raise exception 'Workspace access required' using errcode = '42501';
  end if;
  update public.recipe_photos set state = 'stored' where id = photo;
  delete from baking_import.photo_staging where photo_id = photo;
end;
$$;
revoke all on function public.read_staged_recipe_photo(uuid), public.finish_staged_recipe_photo(uuid) from public, anon;
grant execute on function public.read_staged_recipe_photo(uuid), public.finish_staged_recipe_photo(uuid) to authenticated;

create function baking_import.photo_receipt(import_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('status', status, 'photoId', photo_id, 'recipeId', recipe_id, 'payload', payload, 'replayed', true)
  from baking_import.photo_receipts where id = import_id;
$$;

-- Attach a processed photo from the ChatGPT inbox to an existing recipe in the configured workspace.
create function baking_import.submit_photo(input jsonb, info jsonb, full_image bytea, card_image bytea, thumb_image bytea, source_commit text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  w uuid;
  import_id uuid := (input->>'importId')::uuid;
  explicit_id uuid := nullif(input->>'existingRecipeId','')::uuid;
  old_receipt baking_import.photo_receipts;
  candidates uuid[];
  rid uuid;
  pid uuid;
  existing public.recipe_photos;
  old_primary public.recipe_photos;
  hash text := info->>'sha256';
  stamp text := to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS');
  ext text := case when info->>'contentType' = 'image/jpeg' then 'jpg' else 'webp' end;
  make_primary boolean := coalesce((input->>'setAsPrimary')::boolean, false) or input->>'mode' = 'replacePrimary';
  result text;
begin
  select workspace_id into strict w from baking_import.configuration where kind = 'recipe';
  if import_id is null or input->>'schemaVersion' is distinct from '1' or input->>'kind' is distinct from 'photo'
    or coalesce(input->>'recipeKey','') !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or hash !~ '^[0-9a-f]{64}$'
    or coalesce(input->>'mode','add') not in ('add','replacePrimary') or input ? 'image' or input->>'imageSha256' is distinct from hash
    or info->>'contentType' not in ('image/webp','image/jpeg') or length(input::text) > 8192 then
    raise exception 'Photo import envelope is invalid' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('baking-photo-import:' || w::text, 0));
  select * into old_receipt from baking_import.photo_receipts where id = import_id;
  if found then
    if old_receipt.payload is distinct from input then raise exception 'Import ID is already used by another request' using errcode = '23505'; end if;
    return jsonb_build_object('status', old_receipt.status, 'photoId', old_receipt.photo_id, 'recipeId', old_receipt.recipe_id, 'replayed', true);
  end if;

  select array_agg(distinct m.recipe_id) into candidates from (
    select r.id as recipe_id from public.recipes r where r.workspace_id = w and r.id = explicit_id
    union select rk.recipe_id from baking_import.recipe_keys rk where rk.workspace_id = w and rk.key = 'recipe:' || (input->>'recipeKey')
    union select rv.recipe_id from public.recipe_versions rv where rv.workspace_id = w and input ? 'recipeName'
      and baking_import.name_key(rv.document->>'name') = baking_import.name_key(input->>'recipeName')
  ) m;
  if coalesce(cardinality(candidates),0) = 0 then
    return jsonb_build_object('status','recipe_not_found','replayed',false);
  elsif cardinality(candidates) > 1 then
    return jsonb_build_object('status','ambiguous_recipe','replayed',false);
  end if;
  rid := candidates[1];
  perform 1 from public.recipes where workspace_id = w and id = rid for update;

  select * into existing from public.recipe_photos where workspace_id = w and recipe_id = rid and content_hash = hash;
  select * into old_primary from public.recipe_photos where workspace_id = w and recipe_id = rid and is_primary;
  if existing.id is not null then
    pid := existing.id;
    result := 'already_exists';
  else
    pid := gen_random_uuid();
    insert into public.recipe_photos (id, workspace_id, recipe_id, path, card_path, thumb_path, is_primary, position, caption,
      original_filename, width, height, content_type, content_hash, source, state)
    values (pid, w, rid,
      w || '/recipes/' || rid || '/' || pid || '-full-' || stamp || '.' || ext,
      w || '/recipes/' || rid || '/' || pid || '-card-' || stamp || '.' || ext,
      w || '/recipes/' || rid || '/' || pid || '-thumb-' || stamp || '.' || ext,
      false,
      coalesce((select max(position) + 1 from public.recipe_photos where workspace_id = w and recipe_id = rid), 0),
      left(coalesce(input->>'caption',''), 300), left(coalesce(input->>'filename',''), 255),
      (info->>'width')::integer, (info->>'height')::integer, info->>'contentType', hash, 'chatgpt', 'staged');
    insert into baking_import.photo_staging (photo_id, full_image, card_image, thumb_image) values (pid, full_image, card_image, thumb_image);
    result := 'added';
  end if;

  if make_primary and old_primary.id is distinct from pid then
    update public.recipe_photos set is_primary = false where id = old_primary.id;
    update public.recipe_photos set is_primary = true where id = pid;
    -- Replacing removes the previous main photo. Adding keeps it in the gallery.
    if input->>'mode' = 'replacePrimary' and old_primary.id is not null then
      if old_primary.state = 'stored' then
        insert into public.recipe_photo_trash (path, workspace_id)
          select p, w from unnest(array[old_primary.path, old_primary.card_path, old_primary.thumb_path]) p on conflict do nothing;
      end if;
      delete from public.recipe_photos where id = old_primary.id;
    end if;
  end if;

  insert into baking_import.photo_receipts (id, workspace_id, payload, status, photo_id, recipe_id, commit_sha)
    values (import_id, w, input, result, pid, rid, source_commit);
  return jsonb_build_object('status', result, 'photoId', pid, 'recipeId', rid, 'replayed', false);
end;
$$;

revoke all on function baking_import.submit_photo(jsonb, jsonb, bytea, bytea, bytea, text), baking_import.photo_receipt(uuid) from public, anon, authenticated;
grant execute on function baking_import.submit_photo(jsonb, jsonb, bytea, bytea, bytea, text), baking_import.photo_receipt(uuid) to baking_recipe_runner;
revoke all on all tables in schema baking_import from public, anon, authenticated, baking_recipe_runner, baking_plan_runner;
