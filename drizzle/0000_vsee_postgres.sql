create extension if not exists pgcrypto;

create table if not exists workspaces (
  id text primary key,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists scan_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references workspaces(id),
  mode text not null check (mode in ('xtrace', 'structured')),
  window_days integer not null default 14 check (window_days = 14),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'partial', 'completed', 'failed')),
  current_stage text,
  warning_count integer not null default 0,
  warnings jsonb not null default '[]'::jsonb,
  worker_id text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create unique index if not exists scan_runs_one_active
  on scan_runs (workspace_id, mode, window_days)
  where status in ('queued', 'running');

create table if not exists scan_run_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references scan_runs(id) on delete cascade,
  stage text not null,
  status text not null
    check (status in ('queued', 'running', 'skipped', 'completed', 'failed')),
  warning text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create or replace function claim_next_scan_run(worker_name text)
returns setof scan_runs
language plpgsql
security definer
as $$
declare
  selected_id uuid;
begin
  select id into selected_id
  from scan_runs
  where status = 'queued'
  order by created_at
  for update skip locked
  limit 1;

  if selected_id is null then
    return;
  end if;

  return query
  update scan_runs
  set status = 'running',
      worker_id = worker_name,
      started_at = now()
  where id = selected_id
  returning *;
end;
$$;
