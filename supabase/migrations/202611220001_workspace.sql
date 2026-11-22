create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0)
);

create table public.workspace_members (
  workspace_id uuid references public.workspaces on delete cascade,
  user_id uuid references auth.users on delete cascade,
  role text not null check (role in ('baker', 'admin')),
  primary key (workspace_id, user_id)
);

create function public.is_baking_member(workspace uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members where workspace_id = workspace and user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_baking_member(uuid) from public;
grant execute on function public.is_baking_member(uuid) to authenticated;

create table public.recipes (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces,
  created_at timestamptz not null default now(),
  favorite boolean not null default false,
  unique (workspace_id, id)
);

create table public.recipe_versions (
  id uuid primary key,
  workspace_id uuid not null,
  recipe_id uuid not null,
  created_at timestamptz not null default now(),
  document jsonb not null check (jsonb_typeof(document) = 'object' and document ? 'name'),
  unique (workspace_id, recipe_id, id),
  foreign key (workspace_id, recipe_id) references public.recipes (workspace_id, id)
);

create table public.recipe_approvals (
  workspace_id uuid not null,
  recipe_id uuid not null,
  version_id uuid not null,
  approved_at timestamptz not null default now(),
  approved_by uuid not null default auth.uid() references auth.users,
  primary key (workspace_id, recipe_id),
  foreign key (workspace_id, recipe_id, version_id)
    references public.recipe_versions (workspace_id, recipe_id, id)
);

create table public.planner_records (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces,
  kind text not null check (kind in ('event', 'idea', 'task', 'session', 'photo', 'policy')),
  revision integer not null default 0 check (revision >= 0),
  document jsonb not null check (jsonb_typeof(document) = 'object'),
  updated_at timestamptz not null default now()
);

create index on public.workspace_members (user_id);
create index on public.recipe_versions (workspace_id, recipe_id, created_at desc);
create index on public.planner_records (workspace_id, kind);

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
create policy workspace_read on public.workspaces for select to authenticated using (public.is_baking_member(id));
create policy membership_read on public.workspace_members for select to authenticated using (user_id = (select auth.uid()));

do $$
declare relation text;
begin
  foreach relation in array array['workspaces', 'workspace_members', 'recipes', 'recipe_versions', 'recipe_approvals', 'planner_records'] loop
    execute format('revoke all on public.%I from anon, authenticated', relation);
    execute format('grant select on public.%I to authenticated', relation);
  end loop;
  foreach relation in array array['recipes', 'recipe_versions', 'recipe_approvals', 'planner_records'] loop
    execute format('alter table public.%I enable row level security', relation);
    execute format('create policy member_read on public.%I for select to authenticated using (public.is_baking_member(workspace_id))', relation);
    execute format('create policy member_insert on public.%I for insert to authenticated with check (public.is_baking_member(workspace_id))', relation);
  end loop;
end
$$;

grant insert on public.recipes, public.recipe_versions, public.planner_records to authenticated;
grant insert (workspace_id, recipe_id, version_id) on public.recipe_approvals to authenticated;
grant update (favorite) on public.recipes to authenticated;
grant update (version_id) on public.recipe_approvals to authenticated;
grant update (document, revision) on public.planner_records to authenticated;

create policy member_update_recipe on public.recipes for update to authenticated
  using (public.is_baking_member(workspace_id)) with check (public.is_baking_member(workspace_id));
create policy member_update_approval on public.recipe_approvals for update to authenticated
  using (public.is_baking_member(workspace_id)) with check (public.is_baking_member(workspace_id));
create policy member_update_planner on public.planner_records for update to authenticated
  using (public.is_baking_member(workspace_id)) with check (public.is_baking_member(workspace_id));

create function public.advance_baking_revision()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.revision <> old.revision + 1 then
    raise exception 'Revision must advance by one' using errcode = '23514';
  end if;
  new.updated_at = now();
  return new;
end;
$$;

create trigger advance_baking_revision before update on public.planner_records
  for each row execute function public.advance_baking_revision();

create function public.stamp_baking_approval()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.approved_at = now();
  new.approved_by = auth.uid();
  return new;
end;
$$;

create trigger stamp_baking_approval before update on public.recipe_approvals
  for each row execute function public.stamp_baking_approval();

create function public.save_recipe_version(workspace uuid, recipe uuid, version uuid, body jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare existing public.recipe_versions;
begin
  insert into public.recipes (workspace_id, id) values (workspace, recipe) on conflict (id) do nothing;
  insert into public.recipe_versions (workspace_id, recipe_id, id, document)
    values (workspace, recipe, version, body) on conflict (id) do nothing;
  select * into existing from public.recipe_versions where id = version;
  if not found or (existing.workspace_id, existing.recipe_id, existing.document) is distinct from (workspace, recipe, body) then
    raise exception 'Version identifier already used' using errcode = '23505';
  end if;
  return version;
end;
$$;

revoke all on function public.save_recipe_version(uuid, uuid, uuid, jsonb) from public;
grant execute on function public.save_recipe_version(uuid, uuid, uuid, jsonb) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('baking-photos', 'baking-photos', false, 15728640, array['image/jpeg','image/png','image/webp','image/heic','image/heif','image/avif']);

create policy photos_select on storage.objects for select to authenticated using (
  bucket_id = 'baking-photos' and
  public.is_baking_member((case when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    then (storage.foldername(name))[1] end)::uuid)
);
create policy photos_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'baking-photos' and
  public.is_baking_member((case when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    then (storage.foldername(name))[1] end)::uuid)
);
