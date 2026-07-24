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
  completed_at timestamptz,
  lease_expires_at timestamptz
);

alter table scan_runs
  add column if not exists lease_expires_at timestamptz;

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

create table if not exists worker_heartbeats (
  worker_id text primary key,
  last_seen_at timestamptz not null default now()
);

create table if not exists public_request_limits (
  scope text not null,
  client_hash text not null,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (scope, client_hash)
);

create or replace function public.take_public_request(
  p_scope text,
  p_client_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns table(allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  current_row public.public_request_limits%rowtype;
begin
  if p_limit < 1 or p_window_seconds < 1 then
    raise exception 'Invalid rate-limit configuration';
  end if;

  insert into public.public_request_limits (
    scope,
    client_hash,
    window_started_at,
    request_count,
    updated_at
  )
  values (p_scope, p_client_hash, now(), 1, now())
  on conflict (scope, client_hash) do update
  set window_started_at = case
        when public.public_request_limits.window_started_at
          <= now() - make_interval(secs => p_window_seconds)
        then now()
        else public.public_request_limits.window_started_at
      end,
      request_count = case
        when public.public_request_limits.window_started_at
          <= now() - make_interval(secs => p_window_seconds)
        then 1
        else public.public_request_limits.request_count + 1
      end,
      updated_at = now()
  returning * into current_row;

  allowed := current_row.request_count <= p_limit;
  retry_after_seconds := case
    when allowed then 0
    else greatest(
      1,
      ceil(extract(epoch from (
        current_row.window_started_at
          + make_interval(secs => p_window_seconds)
          - now()
      )))::integer
    )
  end;
  return next;
end;
$$;

create or replace function public.claim_next_scan_run(worker_name text)
returns setof public.scan_runs
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  selected_id uuid;
begin
  update public.scan_runs
  set status = 'queued',
      worker_id = null,
      started_at = null,
      lease_expires_at = null
  where status = 'running'
    and (
      lease_expires_at <= now()
      or (
        lease_expires_at is null
        and started_at <= now() - interval '2 minutes'
      )
    );

  select id into selected_id
  from public.scan_runs
  where status = 'queued'
  order by created_at
  for update skip locked
  limit 1;

  if selected_id is null then
    return;
  end if;

  return query
  update public.scan_runs
  set status = 'running',
      worker_id = worker_name,
      started_at = now(),
      lease_expires_at = now() + interval '2 minutes'
  where id = selected_id
  returning *;
end;
$$;

create table if not exists users (
  id text primary key,
  email text not null unique,
  display_name text not null,
  created_at timestamptz not null default now()
);

create table if not exists workspace_members (
  workspace_id text not null references workspaces(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  role text not null check (role in ('owner')),
  primary key (workspace_id, user_id)
);

create table if not exists source_documents (
  id text primary key,
  filename text not null,
  title text not null,
  role text not null check (role in ('deal_document', 'market_report', 'reference')),
  company_name text,
  deal_id text,
  checksum text not null unique,
  byte_size integer not null,
  object_key text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists workspace_documents (
  workspace_id text not null references workspaces(id) on delete cascade,
  document_id text not null references source_documents(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (workspace_id, document_id)
);

create table if not exists companies (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists deals (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  company_id text not null references companies(id) on delete cascade,
  company_name text not null,
  created_at timestamptz not null default now()
);

create table if not exists source_evidence (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  document_id text not null references source_documents(id) on delete cascade,
  deal_id text not null references deals(id) on delete cascade,
  company_name text not null,
  provenance text not null check (provenance = 'source_document'),
  page integer not null check (page > 0),
  fact text not null,
  excerpt text not null,
  created_at timestamptz not null default now()
);

create table if not exists deal_interactions (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  document_id text not null references source_documents(id) on delete cascade,
  deal_id text not null references deals(id) on delete cascade,
  company_name text not null,
  occurred_at timestamptz not null,
  provenance text not null check (provenance = 'demo_fixture'),
  label text not null
    constraint deal_interactions_demo_fixture_label_check
    check (label = 'Synthetic VC decision record created for the hackathon demo'),
  status text not null check (status in ('screening', 'watchlist', 'evaluating', 'passed', 'invested')),
  concerns jsonb not null default '[]'::jsonb,
  revisit_conditions jsonb not null default '[]'::jsonb,
  meeting_summary text not null,
  created_at timestamptz not null default now()
);

create table if not exists market_events (
  workspace_id text not null references workspaces(id) on delete cascade,
  id text not null,
  published_at timestamptz not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, id)
);

create index if not exists market_events_workspace_published
  on market_events (workspace_id, published_at desc);

create table if not exists intelligence_reports (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  run_id uuid not null references scan_runs(id) on delete cascade,
  created_at timestamptz not null default now(),
  market_summary text not null,
  opportunities jsonb not null default '[]'::jsonb,
  delivery jsonb
);

create index if not exists intelligence_reports_workspace_created
  on intelligence_reports (workspace_id, created_at desc);

create unique index if not exists intelligence_reports_one_per_run
  on intelligence_reports (workspace_id, run_id);

create or replace function public.claim_report_delivery(
  p_report_id text,
  p_recipient text
)
returns setof public.intelligence_reports
language sql
security definer
set search_path = pg_catalog, pg_temp
as $$
  update public.intelligence_reports
  set delivery = jsonb_build_object(
    'status', 'pending',
    'recipient', p_recipient,
    'claimedAt', now()
  )
  where id = p_report_id
    and coalesce(delivery ->> 'status', '') <> 'sent'
    and (
      coalesce(delivery ->> 'status', '') <> 'pending'
      or coalesce(
        (delivery ->> 'claimedAt')::timestamptz,
        '-infinity'::timestamptz
      ) <= now() - interval '5 minutes'
    )
  returning *;
$$;

create table if not exists xtrace_ingest_jobs (
  job_id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  deal_id text not null references deals(id) on delete cascade,
  source_ids jsonb not null default '[]'::jsonb,
  fixture_ids jsonb not null default '[]'::jsonb,
  provenance text not null,
  status text not null check (status in ('pending', 'running', 'succeeded', 'failed')),
  memory_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists xtrace_memory_links (
  memory_id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  deal_id text not null references deals(id) on delete cascade,
  source_ids jsonb not null default '[]'::jsonb,
  fixture_ids jsonb not null default '[]'::jsonb,
  provenance text not null,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'deal_interactions_demo_fixture_label_check'
      and conrelid = 'public.deal_interactions'::regclass
  ) then
    alter table public.deal_interactions
      add constraint deal_interactions_demo_fixture_label_check
      check (label = 'Synthetic VC decision record created for the hackathon demo');
  end if;
end;
$$;

-- The public Web App never talks directly to these tables. RLS has no
-- browser-facing policies: only server-side code holding the Supabase
-- service-role credential may access application data.
do $$
declare
  application_table text;
  restricted_role text;
begin
  foreach application_table in array array[
    'workspaces',
    'users',
    'workspace_members',
    'source_documents',
    'workspace_documents',
    'companies',
    'deals',
    'source_evidence',
    'deal_interactions',
    'market_events',
    'intelligence_reports',
    'scan_runs',
    'scan_run_steps',
    'worker_heartbeats',
    'public_request_limits',
    'xtrace_ingest_jobs',
    'xtrace_memory_links'
  ]
  loop
    execute format(
      'alter table public.%I enable row level security',
      application_table
    );
    execute format(
      'revoke all privileges on table public.%I from public',
      application_table
    );

    for restricted_role in
      select rolname
      from pg_roles
      where rolname in ('anon', 'authenticated')
    loop
      execute format(
        'revoke all privileges on table public.%I from %I',
        application_table,
        restricted_role
      );
    end loop;

    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format(
        'grant all privileges on table public.%I to service_role',
        application_table
      );
    end if;
  end loop;

  revoke all on function public.claim_next_scan_run(text) from public;
  revoke all on function public.take_public_request(text, text, integer, integer) from public;
  revoke all on function public.claim_report_delivery(text, text) from public;

  for restricted_role in
    select rolname
    from pg_roles
    where rolname in ('anon', 'authenticated')
  loop
    execute format(
      'revoke all on function public.claim_next_scan_run(text) from %I',
      restricted_role
    );
    execute format(
      'revoke all on function public.take_public_request(text, text, integer, integer) from %I',
      restricted_role
    );
    execute format(
      'revoke all on function public.claim_report_delivery(text, text) from %I',
      restricted_role
    );
  end loop;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant usage on schema public to service_role;
    grant execute on function public.claim_next_scan_run(text) to service_role;
    grant execute on function public.take_public_request(text, text, integer, integer) to service_role;
    grant execute on function public.claim_report_delivery(text, text) to service_role;
  end if;
end;
$$;
