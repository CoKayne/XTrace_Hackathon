begin;

alter table public.intelligence_reports
  add column if not exists analysis_status text not null default 'completed',
  add column if not exists company_count integer not null default 0,
  add column if not exists belief_revised_count integer not null default 0,
  add column if not exists monitor_count integer not null default 0,
  add column if not exists no_material_change_count integer not null default 0,
  add column if not exists analysis_unavailable_count integer not null default 0,
  add column if not exists priority_deal_id text,
  add column if not exists evidence_coverage jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'intelligence_reports_analysis_status_check'
      and conrelid = 'public.intelligence_reports'::regclass
  ) then
    alter table public.intelligence_reports
      add constraint intelligence_reports_analysis_status_check
      check (analysis_status in ('completed', 'incomplete'));
  end if;
end;
$$;

create table if not exists public.company_analyses (
  id text primary key,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  report_id text not null
    references public.intelligence_reports(id) on delete cascade,
  run_id uuid not null references public.scan_runs(id) on delete cascade,
  deal_id text not null references public.deals(id) on delete cascade,
  company_name text not null,
  deal_status text not null check (
    deal_status in ('screening', 'watchlist', 'evaluating', 'passed', 'invested')
  ),
  outcome text not null check (
    outcome in (
      'belief_revised',
      'monitor',
      'no_material_change',
      'analysis_unavailable'
    )
  ),
  confidence text not null check (confidence in ('low', 'medium', 'high')),
  score double precision not null check (score >= 0 and score <= 1),
  investment_memory jsonb not null,
  market_evidence jsonb not null,
  implications jsonb not null,
  recommended_next_move text not null,
  company_brief jsonb not null,
  source_refs jsonb not null,
  created_at timestamptz not null default now(),
  unique (report_id, deal_id)
);

create index if not exists company_analyses_workspace_deal_created
  on public.company_analyses (workspace_id, deal_id, created_at desc);

create index if not exists company_analyses_report_outcome_score
  on public.company_analyses (report_id, outcome, score desc);

create or replace function public.save_intelligence_report(
  p_report jsonb,
  p_analyses jsonb
)
returns setof public.intelligence_reports
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  target_report_id text;
begin
  if jsonb_typeof(p_report) <> 'object' then
    raise exception 'p_report must be a JSON object';
  end if;
  if jsonb_typeof(p_analyses) <> 'array' then
    raise exception 'p_analyses must be a JSON array';
  end if;

  target_report_id := p_report ->> 'id';
  if target_report_id is null or target_report_id = '' then
    raise exception 'p_report.id is required';
  end if;

  insert into public.intelligence_reports (
    id,
    workspace_id,
    run_id,
    created_at,
    market_summary,
    opportunities,
    analysis_status,
    company_count,
    belief_revised_count,
    monitor_count,
    no_material_change_count,
    analysis_unavailable_count,
    priority_deal_id,
    evidence_coverage
  ) values (
    target_report_id,
    p_report ->> 'workspaceId',
    (p_report ->> 'runId')::uuid,
    coalesce((p_report ->> 'createdAt')::timestamptz, now()),
    p_report ->> 'marketSummary',
    coalesce(p_report -> 'opportunities', '[]'::jsonb),
    coalesce(p_report ->> 'analysisStatus', 'completed'),
    coalesce((p_report ->> 'companyCount')::integer, 0),
    coalesce((p_report ->> 'beliefRevisedCount')::integer, 0),
    coalesce((p_report ->> 'monitorCount')::integer, 0),
    coalesce((p_report ->> 'noMaterialChangeCount')::integer, 0),
    coalesce((p_report ->> 'analysisUnavailableCount')::integer, 0),
    p_report ->> 'priorityDealId',
    coalesce(p_report -> 'evidenceCoverage', '{}'::jsonb)
  )
  on conflict (id) do update set
    workspace_id = excluded.workspace_id,
    run_id = excluded.run_id,
    created_at = excluded.created_at,
    market_summary = excluded.market_summary,
    opportunities = excluded.opportunities,
    analysis_status = excluded.analysis_status,
    company_count = excluded.company_count,
    belief_revised_count = excluded.belief_revised_count,
    monitor_count = excluded.monitor_count,
    no_material_change_count = excluded.no_material_change_count,
    analysis_unavailable_count = excluded.analysis_unavailable_count,
    priority_deal_id = excluded.priority_deal_id,
    evidence_coverage = excluded.evidence_coverage;

  delete from public.company_analyses as company_analysis
  where company_analysis.report_id = target_report_id;

  insert into public.company_analyses (
    id,
    workspace_id,
    report_id,
    run_id,
    deal_id,
    company_name,
    deal_status,
    outcome,
    confidence,
    score,
    investment_memory,
    market_evidence,
    implications,
    recommended_next_move,
    company_brief,
    source_refs,
    created_at
  )
  select
    analysis ->> 'id',
    analysis ->> 'workspaceId',
    analysis ->> 'reportId',
    (analysis ->> 'runId')::uuid,
    analysis ->> 'dealId',
    analysis ->> 'companyName',
    analysis ->> 'dealStatus',
    analysis ->> 'outcome',
    analysis ->> 'confidence',
    (analysis ->> 'score')::double precision,
    analysis -> 'investmentMemory',
    analysis -> 'marketEvidence',
    analysis -> 'implications',
    analysis ->> 'recommendedNextMove',
    analysis -> 'companyBrief',
    analysis -> 'sourceRefs',
    coalesce((analysis ->> 'createdAt')::timestamptz, now())
  from jsonb_array_elements(p_analyses) as analysis;

  return query
  select report.*
  from public.intelligence_reports as report
  where report.id = target_report_id;
end;
$$;

alter table public.company_analyses enable row level security;
revoke all privileges on table public.company_analyses from public;
revoke all on function public.save_intelligence_report(jsonb, jsonb) from public;

do $$
declare
  restricted_role text;
begin
  for restricted_role in
    select rolname
    from pg_roles
    where rolname in ('anon', 'authenticated')
  loop
    execute format(
      'revoke all privileges on table public.company_analyses from %I',
      restricted_role
    );
    execute format(
      'revoke all on function public.save_intelligence_report(jsonb, jsonb) from %I',
      restricted_role
    );
  end loop;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant usage on schema public to service_role;
    grant all privileges on table public.company_analyses to service_role;
    grant execute
      on function public.save_intelligence_report(jsonb, jsonb)
      to service_role;
  end if;
end;
$$;

commit;
