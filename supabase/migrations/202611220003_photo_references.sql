alter table public.planner_records drop constraint planner_records_kind_check;
alter table public.planner_records add constraint planner_records_kind_check
  check (kind in ('event', 'idea', 'task', 'session', 'photo', 'policy', 'reference'));
