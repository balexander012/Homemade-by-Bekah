-- Direct publication from the ChatGPT recipe inbox.
-- "Put it in the app" submissions with a complete formula become the preferred version at once.
-- "Save it so far" submissions keep the existing draft behavior. An optional date adds a calendar event.

-- Approvals made by the inbox have no signed-in app user.
alter table public.recipe_approvals alter column approved_by drop not null;

-- A preferred version may be a finalized, untested formula (Ready for Testing) or a tested one.
-- The version keeps its own status, so an untested formula is never shown as Tested.
create or replace function public.verify_baking_approval()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.recipe_versions where id = new.version_id and recipe_id = new.recipe_id
      and workspace_id = new.workspace_id and document ->> 'status' in ('Tested', 'Ready for Testing')
  ) then
    raise exception 'Only a ready or tested version may be preferred' using errcode = '23514';
  end if;
  return new;
end;
$$;

alter table public.recipe_imports drop constraint if exists recipe_imports_status_check;
alter table public.recipe_imports add constraint recipe_imports_status_check check (status in
  ('incomplete','ready_for_review','already_exists','approved','rejected','found','not_found','published','already_published'));
alter table public.recipe_imports add column event_id uuid;

create or replace function baking_import.submit_recipe(input jsonb, problems text[], source_commit text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  w uuid;
  rid uuid;
  vid uuid;
  prior uuid;
  approved uuid;
  explicit_id uuid;
  event_id uuid;
  import_id uuid := (input->>'importId')::uuid;
  old_receipt public.recipe_imports;
  doc jsonb := input->'recipe';
  operation text := input->>'kind';
  intent text := coalesce(input->>'publicationIntent', 'draft');
  tested jsonb := input->'tested';
  plan jsonb := input->'schedule';
  target_status text;
  name text := coalesce(input->>'name', doc->>'name');
  names text[];
  keys text[];
  candidates uuid[];
  result text;
  event_doc jsonb;
begin
  select workspace_id into strict w from baking_import.configuration where kind='recipe';
  if operation is null or operation not in ('recipe','lookup') or import_id is null or input->>'schemaVersion' is distinct from '1'
    or nullif(btrim(name),'') is null or (input->>'recipeKey') !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    or input->>'recipeKey' is null or length(input::text) > 131072 or cardinality(problems) > 40
    or intent not in ('draft','publish') or (operation='lookup' and (input ? 'publicationIntent' or input ? 'tested' or input ? 'schedule'))
    or (tested is not null and (jsonb_typeof(tested) <> 'object' or (tested->>'testedOn') !~ '^\d{4}-\d{2}-\d{2}$'))
    or (plan is not null and (jsonb_typeof(plan) <> 'object' or (plan->>'date') !~ '^\d{4}-\d{2}-\d{2}$')) then
    raise exception 'Recipe import envelope is invalid' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('baking-recipe-import:' || w::text, 0));
  select * into old_receipt from public.recipe_imports where id=import_id;
  if found then
    if (old_receipt.workspace_id,old_receipt.payload) is distinct from (w,input) then
      raise exception 'Import ID is already used by another request' using errcode='23505';
    end if;
    return jsonb_build_object('status',old_receipt.status,'recipeId',old_receipt.recipe_id,'versionId',old_receipt.version_id,
      'eventId',old_receipt.event_id,'replayed',true);
  end if;

  keys := array['recipe:' || (input->>'recipeKey')];
  if input ? 'sourceKey' then keys := keys || ('source:' || (input->>'sourceKey')); end if;
  select array_agg(distinct alias) into names
  from (select baking_import.name_key(name) as alias
    union select baking_import.name_key(value) from jsonb_array_elements_text(coalesce(input->'aliases','[]'))) n
  where alias <> '';
  keys := keys || array(select 'name:' || n from unnest(names) n);
  explicit_id := nullif(input->>'existingRecipeId','')::uuid;
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
      perform 1 from public.recipes where workspace_id=w and id=rid for update;
      select version_id into approved from public.recipe_approvals where workspace_id=w and recipe_id=rid;
      select rv.id into prior from public.recipe_versions rv where rv.workspace_id=w and rv.recipe_id=rid
        order by (rv.id=approved) desc nulls last, rv.created_at desc, rv.id desc limit 1;
    end if;
    if intent='publish' then
      -- Only a confirmed test makes a version Tested. Otherwise it is ready for its first test bake.
      target_status := case when tested is not null then 'Tested' else 'Ready for Testing' end;
      if rid is not null then
        select rv.id into vid from public.recipe_versions rv
          where rv.workspace_id=w and rv.recipe_id=rid and rv.document->>'status'=target_status
            and baking_import.formula(rv.document)=baking_import.formula(doc)
          order by (rv.id=approved) desc nulls last, rv.created_at desc, rv.id desc limit 1;
      end if;
      rid := coalesce(rid,gen_random_uuid());
      if vid is null then
        vid := gen_random_uuid();
        perform public.save_recipe_version(w,rid,vid,jsonb_set(doc,'{status}',to_jsonb(target_status)));
      end if;
      result := case when approved=vid then 'already_published' else 'published' end;
      insert into public.recipe_approvals(workspace_id,recipe_id,version_id,approved_by) values (w,rid,vid,null)
        on conflict (workspace_id,recipe_id) do update set version_id=excluded.version_id
        where public.recipe_approvals.version_id is distinct from excluded.version_id;
    else
      if rid is not null then
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
    end if;
    insert into baking_import.recipe_keys(workspace_id,key,recipe_id)
      select w,item,rid from unnest(keys) as item on conflict do nothing;
  end if;

  -- A requested bake date becomes a scheduled event. A published recipe is attached so it can be started from the event.
  if operation='recipe' and plan is not null then
    event_id := gen_random_uuid();
    event_doc := jsonb_build_object(
      'title', coalesce(nullif(btrim(plan->>'title'),''), 'Bake ' || name),
      'date', plan->>'date', 'category', 'Personal baking', 'status', 'Scheduled',
      'recipes', case when result in ('published','already_published')
        then jsonb_build_array(jsonb_build_object('versionId', vid, 'target', coalesce(plan->'target', 'null'::jsonb)))
        else '[]'::jsonb end,
      'notes', case when result in ('published','already_published') then coalesce(plan->>'notes','')
        else btrim(coalesce(plan->>'notes','') || E'\n' || name || ' is still a working draft. Finish the recipe to bake it from this event.') end,
      'recurrence', 'None', 'excludedDates', '[]'::jsonb);
    if plan ? 'start' then event_doc := event_doc || jsonb_build_object('start', plan->>'start'); end if;
    if plan ? 'end' then event_doc := event_doc || jsonb_build_object('end', plan->>'end'); end if;
    insert into public.planner_records(id,workspace_id,kind,document) values (event_id,w,'event',event_doc);
  end if;

  insert into public.recipe_imports (id,workspace_id,recipe_id,version_id,previous_version_id,baseline_approval_id,status,payload,issues,commit_sha,approved_version_id,event_id)
    values (import_id,w,rid,vid,prior,approved,result,input,problems,source_commit,
      case when result in ('published','already_published') then vid end, event_id);
  return jsonb_build_object('status',result,'recipeId',rid,'versionId',vid,'eventId',event_id,'replayed',false);
end;
$$;

revoke all on function baking_import.submit_recipe(jsonb,text[],text) from public, anon, authenticated;
grant execute on function baking_import.submit_recipe(jsonb,text[],text) to baking_recipe_runner;
