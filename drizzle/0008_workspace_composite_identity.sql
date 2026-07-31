begin;

set local transaction isolation level read committed;

-- These tables currently use globally unique fixture/import identifiers even
-- though the rows belong to workspaces. Take a single deterministic lock set so
-- no write can move a parent or child between workspaces while the keys change.
lock table
  public.scan_runs,
  public.scan_run_steps,
  public.companies,
  public.deals,
  public.source_evidence,
  public.deal_interactions,
  public.intelligence_reports,
  public.company_analyses,
  public.xtrace_ingest_jobs,
  public.xtrace_memory_links,
  public.uploaded_documents
in access exclusive mode;

-- The launcher checks this before opening the migration, but that check alone
-- has a race: a writer can begin after inspection and commit while the lock is
-- waiting. Re-check inside the transaction immediately after every writer is
-- excluded so a newly committed worker is visible before any catalog change.
do $maintenance_quiescence$
begin
  if exists (
    select 1
    from public.scan_runs
    where status in ('queued', 'running')
      or lease_expires_at is not null
  ) or exists (
    select 1
    from public.uploaded_documents
    where status in ('extracting', 'ingesting_memory')
      or lease_expires_at is not null
  ) then
    raise exception
      'Active scans or upload leases remain; production migration requires a maintenance window'
      using errcode = '55006';
  end if;
end;
$maintenance_quiescence$;

alter table public.scan_run_steps
  add column if not exists workspace_id text;

update public.scan_run_steps as step
set workspace_id = run.workspace_id
from public.scan_runs as run
where step.run_id = run.id
  and step.workspace_id is null;

-- A legacy global-key upsert could have changed a parent's workspace while
-- leaving children behind. Do not silently guess ownership in that case.
do $$
begin
  if exists (
    select 1
    from public.deals as deal
    join public.companies as company on company.id = deal.company_id
    where deal.workspace_id <> company.workspace_id
  ) then
    raise exception
      'Cannot scope Deals by workspace: a Deal and its company disagree on workspace_id';
  end if;

  if exists (
    select 1
    from public.source_evidence as evidence
    join public.deals as deal on deal.id = evidence.deal_id
    where evidence.workspace_id <> deal.workspace_id
  ) then
    raise exception
      'Cannot scope source evidence by workspace: evidence and Deal disagree on workspace_id';
  end if;

  if exists (
    select 1
    from public.deal_interactions as interaction
    join public.deals as deal on deal.id = interaction.deal_id
    where interaction.workspace_id <> deal.workspace_id
  ) then
    raise exception
      'Cannot scope Deal interactions by workspace: interaction and Deal disagree on workspace_id';
  end if;

  if exists (
    select 1
    from public.intelligence_reports as report
    join public.scan_runs as run on run.id = report.run_id
    where report.workspace_id <> run.workspace_id
  ) then
    raise exception
      'Cannot scope intelligence reports by workspace: report and run disagree on workspace_id';
  end if;

  if exists (
    select 1
    from public.company_analyses as analysis
    join public.intelligence_reports as report on report.id = analysis.report_id
    where analysis.workspace_id <> report.workspace_id
  ) then
    raise exception
      'Cannot scope company analyses by workspace: analysis and report disagree on workspace_id';
  end if;

  if exists (
    select 1
    from public.company_analyses as analysis
    join public.scan_runs as run on run.id = analysis.run_id
    where analysis.workspace_id <> run.workspace_id
  ) then
    raise exception
      'Cannot scope company analyses by workspace: analysis and run disagree on workspace_id';
  end if;

  if exists (
    select 1
    from public.company_analyses as analysis
    join public.deals as deal on deal.id = analysis.deal_id
    where analysis.workspace_id <> deal.workspace_id
  ) then
    raise exception
      'Cannot scope company analyses by workspace: analysis and Deal disagree on workspace_id';
  end if;

  if exists (
    select 1
    from public.xtrace_ingest_jobs as job
    join public.deals as deal on deal.id = job.deal_id
    where job.workspace_id <> deal.workspace_id
  ) then
    raise exception
      'Cannot scope XTrace ingest jobs by workspace: job and Deal disagree on workspace_id';
  end if;

  if exists (
    select 1
    from public.xtrace_memory_links as memory_link
    join public.deals as deal on deal.id = memory_link.deal_id
    where memory_link.workspace_id <> deal.workspace_id
  ) then
    raise exception
      'Cannot scope XTrace memory links by workspace: memory and Deal disagree on workspace_id';
  end if;

  if exists (
    select 1
    from public.scan_run_steps
    where workspace_id is null
  ) then
    raise exception
      'Cannot scope scan run steps by workspace: at least one step has no matching run';
  end if;
end;
$$;

alter table public.scan_run_steps
  alter column workspace_id set not null;

-- Drop scalar foreign keys before replacing the referenced global primary keys.
alter table public.scan_run_steps
  drop constraint if exists scan_run_steps_run_id_fkey;
alter table public.deals
  drop constraint if exists deals_company_id_fkey;
alter table public.source_evidence
  drop constraint if exists source_evidence_deal_id_fkey;
alter table public.deal_interactions
  drop constraint if exists deal_interactions_deal_id_fkey;
alter table public.intelligence_reports
  drop constraint if exists intelligence_reports_run_id_fkey;
alter table public.company_analyses
  drop constraint if exists company_analyses_report_id_fkey,
  drop constraint if exists company_analyses_run_id_fkey,
  drop constraint if exists company_analyses_deal_id_fkey,
  drop constraint if exists company_analyses_report_id_deal_id_key,
  drop constraint if exists company_analyses_report_deal_unique;
alter table public.xtrace_ingest_jobs
  drop constraint if exists xtrace_ingest_jobs_deal_id_fkey;
alter table public.xtrace_memory_links
  drop constraint if exists xtrace_memory_links_deal_id_fkey;

alter table public.companies
  drop constraint if exists companies_pkey,
  add constraint companies_pkey primary key (workspace_id, id);

alter table public.deals
  drop constraint if exists deals_pkey,
  add constraint deals_pkey primary key (workspace_id, id);

alter table public.source_evidence
  drop constraint if exists source_evidence_pkey,
  add constraint source_evidence_pkey primary key (workspace_id, id);

alter table public.deal_interactions
  drop constraint if exists deal_interactions_pkey,
  add constraint deal_interactions_pkey primary key (workspace_id, id);

alter table public.intelligence_reports
  drop constraint if exists intelligence_reports_pkey,
  add constraint intelligence_reports_pkey primary key (workspace_id, id);

alter table public.company_analyses
  drop constraint if exists company_analyses_pkey,
  add constraint company_analyses_pkey primary key (workspace_id, id);

alter table public.xtrace_ingest_jobs
  drop constraint if exists xtrace_ingest_jobs_pkey,
  add constraint xtrace_ingest_jobs_pkey primary key (workspace_id, job_id);

alter table public.xtrace_memory_links
  drop constraint if exists xtrace_memory_links_pkey,
  add constraint xtrace_memory_links_pkey primary key (workspace_id, memory_id);

alter table public.uploaded_documents
  drop constraint if exists uploaded_documents_pkey,
  add constraint uploaded_documents_pkey primary key (workspace_id, id);

alter table public.scan_runs
  add constraint scan_runs_workspace_id_id_unique
  unique (workspace_id, id);

alter table public.scan_run_steps
  add constraint scan_run_steps_workspace_run_fkey
  foreign key (workspace_id, run_id)
  references public.scan_runs (workspace_id, id)
  on delete cascade;

alter table public.deals
  add constraint deals_workspace_company_fkey
  foreign key (workspace_id, company_id)
  references public.companies (workspace_id, id)
  on delete cascade;

alter table public.source_evidence
  add constraint source_evidence_workspace_deal_fkey
  foreign key (workspace_id, deal_id)
  references public.deals (workspace_id, id)
  on delete cascade;

alter table public.deal_interactions
  add constraint deal_interactions_workspace_deal_fkey
  foreign key (workspace_id, deal_id)
  references public.deals (workspace_id, id)
  on delete cascade;

alter table public.intelligence_reports
  add constraint intelligence_reports_workspace_run_fkey
  foreign key (workspace_id, run_id)
  references public.scan_runs (workspace_id, id)
  on delete cascade;

alter table public.company_analyses
  add constraint company_analyses_workspace_report_fkey
  foreign key (workspace_id, report_id)
  references public.intelligence_reports (workspace_id, id)
  on delete cascade,
  add constraint company_analyses_workspace_run_fkey
  foreign key (workspace_id, run_id)
  references public.scan_runs (workspace_id, id)
  on delete cascade,
  add constraint company_analyses_workspace_deal_fkey
  foreign key (workspace_id, deal_id)
  references public.deals (workspace_id, id)
  on delete cascade,
  add constraint company_analyses_workspace_report_deal_unique
  unique (workspace_id, report_id, deal_id);

alter table public.xtrace_ingest_jobs
  add constraint xtrace_ingest_jobs_workspace_deal_fkey
  foreign key (workspace_id, deal_id)
  references public.deals (workspace_id, id)
  on delete cascade;

alter table public.xtrace_memory_links
  add constraint xtrace_memory_links_workspace_deal_fkey
  foreign key (workspace_id, deal_id)
  references public.deals (workspace_id, id)
  on delete cascade;

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
  target_workspace_id text;
begin
  if jsonb_typeof(p_report) <> 'object' then
    raise exception 'p_report must be a JSON object';
  end if;
  if jsonb_typeof(p_analyses) <> 'array' then
    raise exception 'p_analyses must be a JSON array';
  end if;

  target_report_id := p_report ->> 'id';
  target_workspace_id := p_report ->> 'workspaceId';
  if target_report_id is null or target_report_id = '' then
    raise exception 'p_report.id is required';
  end if;
  if target_workspace_id is null or target_workspace_id = '' then
    raise exception 'p_report.workspaceId is required';
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
    target_workspace_id,
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
  on conflict (workspace_id, id) do update set
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
  where company_analysis.workspace_id = target_workspace_id
    and company_analysis.report_id = target_report_id;

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
    target_workspace_id,
    target_report_id,
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
  where report.workspace_id = target_workspace_id
    and report.id = target_report_id;
end;
$$;

commit;

notify pgrst, 'reload schema';
