-- One explicitly registered client and consented workspace at a time per user.
create table public.baking_oauth_grants (
  client_id uuid not null,
  workspace_id uuid not null,
  user_id uuid not null,
  resource text not null check (resource ~ '^https://.+/api/mcp$'),
  can_write boolean not null default false,
  primary key (client_id, user_id),
  foreign key (workspace_id, user_id) references public.workspace_members (workspace_id, user_id) on delete cascade
);
alter table public.baking_oauth_grants enable row level security;
revoke all on public.baking_oauth_grants from anon, authenticated;

create function public.baking_oauth_allowed(workspace uuid, for_write boolean default false)
returns boolean language sql stable security definer set search_path = ''
as $$
  select (auth.jwt() ->> 'client_id') is null or exists (
    select 1 from public.baking_oauth_grants
    where workspace_id = workspace and user_id = (select auth.uid())
      and client_id::text = auth.jwt() ->> 'client_id'
      and resource = auth.jwt() ->> 'aud'
      and (not for_write or can_write)
  );
$$;
revoke all on function public.baking_oauth_allowed(uuid, boolean) from public;
grant execute on function public.baking_oauth_allowed(uuid, boolean) to authenticated;

create function public.baking_oauth_token_hook(event jsonb)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare target text;
declare writable boolean;
begin
  if coalesce(event ->> 'client_id', event -> 'claims' ->> 'client_id') is null then
    return event;
  end if;
  select resource, can_write into target, writable
    from public.baking_oauth_grants
    where client_id::text = coalesce(event ->> 'client_id', event -> 'claims' ->> 'client_id')
      and user_id::text = event ->> 'user_id';
  if target is null then
    return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'Baking OAuth access is not configured'));
  end if;
  return jsonb_set(jsonb_set(event, '{claims,aud}', to_jsonb(target)), '{claims,baking_write}', to_jsonb(writable));
end;
$$;
revoke all on function public.baking_oauth_token_hook(jsonb) from public, anon, authenticated;
grant execute on function public.baking_oauth_token_hook(jsonb) to supabase_auth_admin;

create policy oauth_workspace on public.workspaces as restrictive for select to authenticated
  using (public.baking_oauth_allowed(id));
create policy oauth_membership on public.workspace_members as restrictive for select to authenticated
  using (public.baking_oauth_allowed(workspace_id));

do $$
declare relation text;
begin
  foreach relation in array array['recipes','recipe_versions','recipe_approvals','planner_records'] loop
    execute format('create policy oauth_read on public.%I as restrictive for select to authenticated using (public.baking_oauth_allowed(workspace_id))', relation);
    execute format('create policy oauth_write on public.%I as restrictive for insert to authenticated with check (public.baking_oauth_allowed(workspace_id, true))', relation);
  end loop;
end
$$;

create policy oauth_read_records on public.planner_records as restrictive for select to authenticated
  using ((auth.jwt() ->> 'client_id') is null or kind in ('event', 'idea', 'task', 'session'));
create policy oauth_insert_records on public.planner_records as restrictive for insert to authenticated
  with check ((auth.jwt() ->> 'client_id') is null or kind in ('event', 'idea', 'task', 'session'));
create policy oauth_update_records on public.planner_records as restrictive for update to authenticated
  using (public.baking_oauth_allowed(workspace_id, true) and
    ((auth.jwt() ->> 'client_id') is null or kind in ('event', 'idea', 'task', 'session')))
  with check (public.baking_oauth_allowed(workspace_id, true) and
    ((auth.jwt() ->> 'client_id') is null or kind in ('event', 'idea', 'task', 'session')));
create policy oauth_draft_only on public.recipe_versions as restrictive for insert to authenticated
  with check ((auth.jwt() ->> 'client_id') is null or document ->> 'status' = 'Draft');
create policy oauth_no_approval_insert on public.recipe_approvals as restrictive for insert to authenticated
  with check ((auth.jwt() ->> 'client_id') is null);
create policy oauth_no_approval_update on public.recipe_approvals as restrictive for update to authenticated
  using ((auth.jwt() ->> 'client_id') is null) with check ((auth.jwt() ->> 'client_id') is null);
create policy oauth_no_favorites on public.recipes as restrictive for update to authenticated
  using ((auth.jwt() ->> 'client_id') is null) with check ((auth.jwt() ->> 'client_id') is null);
create policy oauth_no_photo_read on storage.objects as restrictive for select to authenticated
  using (bucket_id <> 'baking-photos' or (auth.jwt() ->> 'client_id') is null);
create policy oauth_no_photo_upload on storage.objects as restrictive for insert to authenticated
  with check (bucket_id <> 'baking-photos' or (auth.jwt() ->> 'client_id') is null);

create table public.baking_audit (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces,
  actor uuid references auth.users on delete set null,
  oauth_client text,
  relation_name text not null,
  row_id uuid not null,
  action text not null,
  recorded_at timestamptz not null default now()
);
alter table public.baking_audit enable row level security;
revoke all on public.baking_audit from anon, authenticated;

create function public.audit_baking_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.baking_audit (workspace_id, actor, oauth_client, relation_name, row_id, action)
  values (new.workspace_id, auth.uid(), auth.jwt() ->> 'client_id', tg_table_name,
    (to_jsonb(new) ->> (case when tg_table_name = 'recipe_approvals' then 'recipe_id' else 'id' end))::uuid, tg_op);
  return new;
end;
$$;
revoke all on function public.audit_baking_change() from public;
create trigger audit_planner after insert or update on public.planner_records for each row execute function public.audit_baking_change();
create trigger audit_versions after insert on public.recipe_versions for each row execute function public.audit_baking_change();
create trigger audit_approvals after insert or update on public.recipe_approvals for each row execute function public.audit_baking_change();

-- Every approval, including callers using PostgREST directly, must designate a tested version.
create function public.verify_baking_approval()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.recipe_versions where id = new.version_id and recipe_id = new.recipe_id
      and workspace_id = new.workspace_id and document ->> 'status' = 'Tested'
  ) then
    raise exception 'Only a tested version may be approved' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger verify_baking_approval before insert or update on public.recipe_approvals
  for each row execute function public.verify_baking_approval();

-- Keep operation limits in force even if an OAuth client calls PostgREST directly.
create function public.limit_baking_oauth_writes()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (auth.jwt() ->> 'client_id') is null then return new; end if;
  if new.kind = 'event' then
    if coalesce(new.document ->> 'status', '') not in ('Draft', 'Scheduled')
      or (tg_op = 'INSERT' and coalesce(new.document -> 'excludedDates', '[]') <> '[]')
      or (tg_op = 'UPDATE' and (old.document ->> 'status' in ('Cancelled','Completed')
        or old.document -> 'excludedDates' is distinct from new.document -> 'excludedDates')) then
      raise exception 'Manage event cancellation and completion in the workspace' using errcode = '42501';
    end if;
  elsif new.kind = 'session' then
    if tg_op = 'INSERT' then
      raise exception 'Start baking sessions in the workspace' using errcode = '42501';
    end if;
    if old.document - array['title', 'mode', 'feedback', 'recipes'] <>
      new.document - array['title', 'mode', 'feedback', 'recipes']
      or not (coalesce(new.document -> 'recipes', '[]') @> coalesce(old.document -> 'recipes', '[]'))
      or exists (
        select 1 from jsonb_array_elements(coalesce(new.document -> 'recipes', '[]')) item
        where not (coalesce(old.document -> 'recipes', '[]') @> jsonb_build_array(item))
          and coalesce(item -> 'completed', '[]') <> '[]'
      ) then
      raise exception 'Manage baking progress in the workspace' using errcode = '42501';
    end if;
  elsif new.kind = 'task' and coalesce(new.document ->> 'status', '') not in ('Open','Done') then
    raise exception 'Manage dismissed tasks in the workspace' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger limit_baking_oauth_writes before insert or update on public.planner_records
  for each row execute function public.limit_baking_oauth_writes();
