-- One login per inbox, with only a single worker entry point per login.
create schema baking_import;
revoke all on schema baking_import from public;
do $$
begin
  create role baking_recipe_runner nologin noinherit nocreatedb nocreaterole noreplication;
  create role baking_plan_runner nologin noinherit nocreatedb nocreaterole noreplication;
end
$$;
grant usage on schema baking_import to baking_recipe_runner, baking_plan_runner;
-- pg_catalog is available for session setup. The worker roles inherit no app role.

create table baking_import.configuration (
  kind text primary key check (kind in ('recipe','plan')),
  workspace_id uuid not null references public.workspaces(id)
);

create table public.recipe_imports (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id),
  recipe_id uuid,
  version_id uuid,
  previous_version_id uuid,
  baseline_approval_id uuid,
  status text not null check (status in ('incomplete','ready_for_review','already_exists','approved','rejected','found','not_found')),
  payload jsonb not null,
  issues text[] not null default '{}',
  commit_sha text not null check (commit_sha ~ '^[0-9a-f]{40}$'),
  imported_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  approved_version_id uuid,
  foreign key (workspace_id, recipe_id) references public.recipes(workspace_id,id),
  foreign key (workspace_id, recipe_id, version_id) references public.recipe_versions(workspace_id,recipe_id,id),
  foreign key (workspace_id, recipe_id, previous_version_id) references public.recipe_versions(workspace_id,recipe_id,id),
  foreign key (workspace_id, recipe_id, baseline_approval_id) references public.recipe_versions(workspace_id,recipe_id,id),
  foreign key (workspace_id, recipe_id, approved_version_id) references public.recipe_versions(workspace_id,recipe_id,id)
);
create index on public.recipe_imports (workspace_id, imported_at desc, id);
alter table public.recipe_imports enable row level security;
revoke all on public.recipe_imports from public, anon, authenticated;
grant select on public.recipe_imports to authenticated;
create policy member_recipe_imports on public.recipe_imports for select to authenticated
using (public.is_baking_member(workspace_id) and (auth.jwt() ->> 'client_id') is null);

create table baking_import.recipe_keys (
  workspace_id uuid not null,
  key text not null,
  recipe_id uuid not null,
  primary key (workspace_id,key),
  foreign key (workspace_id,recipe_id) references public.recipes(workspace_id,id)
);
create table baking_import.plan_receipts (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id),
  payload jsonb not null,
  commit_sha text not null check (commit_sha ~ '^[0-9a-f]{40}$'),
  received_at timestamptz not null default now(),
  resulting_revision integer not null
);

alter table baking_import.configuration enable row level security;
alter table baking_import.recipe_keys enable row level security;
alter table baking_import.plan_receipts enable row level security;

create function baking_import.name_key(input text) returns text
language sql immutable strict set search_path = '' as $$
  select pg_catalog.regexp_replace(
    pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.replace(input, '&', ' and ')), '[’'']', '', 'g'),
    '[^[:alnum:]]', '', 'g');
$$;

-- Use ingredient positions instead of client-generated IDs when comparing the ordered formula.
create function baking_import.formula(doc jsonb) returns jsonb
language sql immutable strict set search_path = '' as $$
  select (doc - array['name','status','source','description','changeReason','tags','ingredients','steps']) ||
    jsonb_build_object(
      'ingredients', (select coalesce(jsonb_agg(i.item - 'id' order by i.ord), '[]') from jsonb_array_elements(doc->'ingredients') with ordinality as i(item,ord)),
      'steps', (select coalesce(jsonb_agg((s.item - array['id','ingredients']) || jsonb_build_object('ingredients',
        (select coalesce(jsonb_agg(i.ord order by i.ord), '[]')
         from jsonb_array_elements(doc->'ingredients') with ordinality as i(item,ord)
         where s.item->'ingredients' ? (i.item->>'id'))) order by s.ord), '[]')
        from jsonb_array_elements(doc->'steps') with ordinality as s(item,ord)));
$$;

create function baking_import.recipe_ready(doc jsonb) returns boolean
language sql immutable strict set search_path = '' as $$
  select coalesce((case when jsonb_typeof(doc->'yieldLow') = 'number'
      then (doc->>'yieldLow')::numeric between 0.000001 and 100000 else false end) and
    jsonb_typeof(doc->'name') = 'string' and jsonb_typeof(doc->'category') = 'string' and
    jsonb_typeof(doc->'yieldUnit') = 'string' and jsonb_typeof(doc->'tags') = 'array' and
    jsonb_typeof(doc->'equipment') = 'array' and jsonb_typeof(doc->'prep') = 'array' and
    jsonb_typeof(doc->'exceptions') = 'array' and jsonb_typeof(doc->'shots') = 'array' and
    nullif(btrim(doc->>'source'),'') is not null and
    jsonb_typeof(doc->'ingredients') = 'array' and jsonb_array_length(doc->'ingredients') > 0 and
    jsonb_typeof(doc->'steps') = 'array' and jsonb_array_length(doc->'steps') > 0 and
    not exists (select 1 from jsonb_array_elements(doc->'ingredients') as i(item)
      where case when jsonb_typeof(i.item->'quantity') = 'number'
                   then (i.item->>'quantity')::numeric not between 0.000001 and 100000
                   else true end
        or nullif(btrim(i.item->>'name'),'') is null or nullif(btrim(i.item->>'unit'),'') is null
        or not exists (select 1 from jsonb_array_elements(doc->'steps') s(item) where s.item->'ingredients' ? (i.item->>'id'))) and
    not exists (select 1 from jsonb_array_elements(doc->'steps') s(item)
      where nullif(btrim(s.item->>'instruction'),'') is null
        or coalesce(s.item->>'kind','') not in ('Work','Rest','Oven','Cool')
        or jsonb_typeof(s.item->'ingredients') is distinct from 'array'
        or (s.item->>'kind' = 'Oven'  and jsonb_typeof(s.item->'temperature') is distinct from 'number')
        or (s.item->>'kind' in ('Oven','Rest','Cool') and jsonb_typeof(s.item->'minutes') is distinct from 'number')), false);
$$;

create function baking_import.submit_recipe(input jsonb, problems text[], source_commit text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  w uuid;
  rid uuid;
  vid uuid;
  prior uuid;
  approved uuid;
  explicit_id uuid;
  import_id uuid := (input->>'importId')::uuid;
  old_receipt public.recipe_imports;
  doc jsonb := input->'recipe';
  operation text := input->>'kind';
  name text := coalesce(input->>'name', doc->>'name');
  names text[];
  keys text[];
  candidates uuid[];
  result text;
begin
  select workspace_id into strict w from baking_import.configuration where kind='recipe';
  if operation is null or operation not in ('recipe','lookup') or import_id is null or input->>'schemaVersion' is distinct from '1'
    or nullif(btrim(name),'') is null or (input->>'recipeKey') !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    or input->>'recipeKey' is null or length(input::text) > 131072 or cardinality(problems) > 40 then
    raise exception 'Recipe import envelope is invalid' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('baking-recipe-import:' || w::text, 0));
  select * into old_receipt from public.recipe_imports where id=import_id;
  if found then
    if (old_receipt.workspace_id,old_receipt.payload) is distinct from (w,input) then
      raise exception 'Import ID is already used by another request' using errcode='23505';
    end if;
    return jsonb_build_object('status',old_receipt.status,'recipeId',old_receipt.recipe_id,'versionId',old_receipt.version_id,'replayed',true);
  end if;

  keys := array['recipe:' || (input->>'recipeKey')];
  if input ? 'sourceKey' then keys := keys || ('source:' || (input->>'sourceKey')); end if;
  select array_agg(distinct alias) into names
  from (select baking_import.name_key(name) as alias
    union select baking_import.name_key(value) from jsonb_array_elements_text(coalesce(input->'aliases','[]'))) n
  where alias <> '';
  keys := keys || array(select 'name:' || n from unnest(names) n);
  explicit_id := nullif(input->>'existingRecipeId','')::uuid;
  -- Explicit IDs, previous aliases and names must agree before a draft can be assigned.
  select array_agg(distinct match.recipe_id) into candidates from (
    select rk.recipe_id from baking_import.recipe_keys rk where rk.workspace_id=w and rk.key=any(keys)
    union
    select rv.recipe_id from public.recipe_versions rv where rv.workspace_id=w and baking_import.name_key(rv.document->>'name')=any(names)
    union
    select r.id from public.recipes r where r.workspace_id=w and r.id=explicit_id
  ) match;
  if explicit_id is not null and not exists(select 1 from public.recipes where workspace_id=w and id=explicit_id) then
    problems := array_append(problems, 'The specified library recipe ID was not found in this workspace.');
  end if;
  if coalesce(cardinality(candidates),0)>1 then
    problems := array_append(problems, 'More than one library recipe matches. Resolve the identifiers and submit a fresh import.');
  elsif cardinality(candidates)=1 then rid := candidates[1];
  end if;

  if cardinality(problems)>0 then
    result := 'incomplete';
  elsif operation='lookup' then
    result := case when rid is null then 'not_found' else 'found' end;
  elsif doc->>'status' is distinct from 'Draft' or input->>'verification' is distinct from 'Finalized'
    or coalesce(baking_import.recipe_ready(doc),false) is false then
    result := 'incomplete';
    problems := array_append(problems, 'The recipe needs verified quantities, yield, source, instructions and applicable times.');
  else
    if rid is not null then
      select version_id into approved from public.recipe_approvals where workspace_id=w and recipe_id=rid;
      select rv.id into prior from public.recipe_versions rv where rv.workspace_id=w and rv.recipe_id=rid
        order by (rv.id=approved) desc nulls last, rv.created_at desc, rv.id desc limit 1;
      select rv.id into vid from public.recipe_versions rv
        where rv.workspace_id=w and rv.recipe_id=rid and baking_import.formula(rv.document)=baking_import.formula(doc)
        order by (rv.id=approved) desc nulls last, rv.created_at desc, rv.id desc limit 1;
    end if;
    if vid is not null then
      result := 'already_exists';
    else
      rid := coalesce(rid,gen_random_uuid());
      vid := gen_random_uuid();
      perform public.save_recipe_version(w,rid,vid,doc);
      result := 'ready_for_review';
    end if;
    insert into baking_import.recipe_keys(workspace_id,key,recipe_id)
      select w,item,rid from unnest(keys) as item on conflict do nothing;
  end if;
  insert into public.recipe_imports (id,workspace_id,recipe_id,version_id,previous_version_id,baseline_approval_id,status,payload,issues,commit_sha)
    values (import_id,w,rid,vid,prior,approved,result,input,problems,source_commit);
  return jsonb_build_object('status',result,'recipeId',rid,'versionId',vid,'replayed',false);
end;
$$;

create function public.review_baking_recipe_import(import_id uuid, decision text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  entry public.recipe_imports;
  current_approval uuid;
  approved_version uuid;
  draft jsonb;
begin
  select * into entry from public.recipe_imports where id=import_id for update;
  if not found or auth.uid() is null or (auth.jwt()->>'client_id') is not null or not public.is_baking_member(entry.workspace_id) then
    raise exception 'Workspace access required' using errcode='42501';
  end if;
  if decision='reject' and entry.status='rejected' then return null; end if;
  if decision='approve' and entry.status='approved' then return entry.approved_version_id; end if;
  if decision='reject' and entry.status in ('ready_for_review','incomplete') then
    -- Preserve the original draft and the audit trail without changing the preferred version.
    update public.recipe_imports set status='rejected', reviewed_at=now(), reviewed_by=auth.uid() where id=import_id;
    return null;
  end if;
  if decision is distinct from 'approve' or entry.status<>'ready_for_review' then
    raise exception 'Only a complete pending draft may be approved' using errcode='22023';
  end if;
  perform 1 from public.recipes where workspace_id=entry.workspace_id and id=entry.recipe_id for update;
  select version_id into current_approval from public.recipe_approvals
    where workspace_id=entry.workspace_id and recipe_id=entry.recipe_id for update;
  if current_approval is distinct from entry.baseline_approval_id then
    raise exception 'The approved recipe changed. Compare the latest version before approving.' using errcode='40001';
  end if;
  select document into strict draft from public.recipe_versions where workspace_id=entry.workspace_id and id=entry.version_id;
  if not baking_import.recipe_ready(draft) then raise exception 'The draft is incomplete' using errcode='22023'; end if;
  approved_version := gen_random_uuid();
  perform public.save_recipe_version(entry.workspace_id,entry.recipe_id,approved_version,jsonb_set(draft,'{status}','"Tested"'));
  if current_approval is null then
    insert into public.recipe_approvals(workspace_id,recipe_id,version_id) values (entry.workspace_id,entry.recipe_id,approved_version);
  else
    update public.recipe_approvals set version_id=approved_version
      where workspace_id=entry.workspace_id and recipe_id=entry.recipe_id;
  end if;
  update public.recipe_imports set status='approved', reviewed_at=now(), reviewed_by=auth.uid(), approved_version_id=approved_version
    where id=import_id;
  return approved_version;
end;
$$;

create function baking_import.submit_plan(input jsonb, source_commit text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  w uuid;
  import_id uuid := (input->>'importId')::uuid;
  record_id uuid := (input->>'recordId')::uuid;
  operation text := input->>'kind';
  doc jsonb := input->operation;
  expected integer := (input->>'expectedRevision')::integer;
  existing public.planner_records;
  old_receipt baking_import.plan_receipts;
  changed integer := 0;
begin
  select workspace_id into strict w from baking_import.configuration where kind='plan';
  if import_id is null or record_id is null or operation is null or operation not in ('event','task','idea')
    or input->>'schemaVersion' is distinct from '1' or jsonb_typeof(doc) is distinct from 'object' or length(input::text)>131072
    or (operation='event' and (doc->>'status' is distinct from 'Scheduled' or coalesce(jsonb_array_length(doc->'excludedDates'),0)>0))
    or (operation='task' and (doc->>'status' is distinct from 'Open' or doc->>'section' is distinct from 'Preparation'))
    or (operation='idea' and (doc->>'status' is distinct from 'Idea' or doc ? 'image')) then
    raise exception 'Plan import envelope is invalid' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('baking-plan-import:' || w::text, 0));
  select * into old_receipt from baking_import.plan_receipts where id=import_id;
  if found then
    if (old_receipt.workspace_id,old_receipt.payload) is distinct from (w,input) then raise exception 'Import ID is already used' using errcode='23505'; end if;
    return jsonb_build_object('status','saved','revision',old_receipt.resulting_revision,'replayed',true);
  end if;
  if operation='event' and exists (
    select 1 from jsonb_array_elements(doc->'recipes') ref where not exists (
      select 1 from public.recipe_versions v where v.workspace_id=w and v.id=(ref->>'versionId')::uuid
    )
  ) then raise exception 'An assigned recipe version is unavailable' using errcode='23503'; end if;
  if operation='task' and doc ? 'eventId' and not exists (
    select 1 from public.planner_records where workspace_id=w and id=(doc->>'eventId')::uuid and kind='event'
  ) then raise exception 'The preparation event is unavailable' using errcode='23503'; end if;
  select * into existing from public.planner_records where id=record_id for update;
  if found then
    if existing.workspace_id<>w or existing.kind<>operation then raise exception 'Record ID is already used' using errcode='23505'; end if;
    if existing.document=doc then
      changed := existing.revision;
    elsif operation='event' and expected=existing.revision and existing.document->>'status' in ('Scheduled','Draft')
      and coalesce(jsonb_array_length(existing.document->'excludedDates'),0)=0 then
      update public.planner_records set document=doc, revision=revision+1 where id=record_id returning revision into changed;
    else raise exception 'Conflict. Use the current event revision or a unique record ID.' using errcode='40001';
    end if;
  elsif expected is not null then
    raise exception 'The event to update does not exist' using errcode='23503';
  else
    insert into public.planner_records(id,workspace_id,kind,document) values (record_id,w,operation,doc);
  end if;
  insert into baking_import.plan_receipts(id,workspace_id,payload,commit_sha,resulting_revision) values (import_id,w,input,source_commit,changed);
  return jsonb_build_object('status','saved','revision',changed,'replayed',false);
end;
$$;

revoke all on all functions in schema baking_import from public, anon, authenticated;
revoke all on all tables in schema baking_import from public, anon, authenticated, baking_recipe_runner, baking_plan_runner;
grant execute on function baking_import.submit_recipe(jsonb,text[],text) to baking_recipe_runner;
grant execute on function baking_import.submit_plan(jsonb,text) to baking_plan_runner;
revoke all on function public.review_baking_recipe_import(uuid,text) from public, anon, authenticated;
grant execute on function public.review_baking_recipe_import(uuid,text) to authenticated;
