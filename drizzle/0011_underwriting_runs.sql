begin;

set local transaction isolation level read committed;

do $maintenance_locks$
declare
  app_table_name text;
begin
  foreach app_table_name in array array[
    'action_drafts',
    'benchmark_packs',
    'candidate_checkpoints',
    'candidate_context_snapshots',
    'candidate_runs',
    'candidate_version_snapshots',
    'deals',
    'evidence_packs',
    'final_syntheses',
    'framework_disagreement_artifacts',
    'framework_judgment_artifacts',
    'fund_policy_versions',
    'scan_runs',
    'scenario_models',
    'underwriting_batches',
    'underwriting_calculations',
    'underwriting_claim_edges',
    'underwriting_narratives',
    'underwriting_selections',
    'uploaded_documents',
    'valuation_evaluations',
    'workspaces'
  ]
  loop
    if pg_catalog.to_regclass(
      pg_catalog.format('public.%I', app_table_name)
    ) is not null then
      execute pg_catalog.format(
        'lock table public.%I in access exclusive mode',
        app_table_name
      );
    end if;
  end loop;
end;
$maintenance_locks$;

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

do $underwriting_owner_prepare$
declare
  executor_role text := current_user;
  executor_is_superuser boolean;
begin
  select rolsuper into executor_is_superuser
  from pg_catalog.pg_roles where rolname = executor_role;
  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'vsee_underwriting_owner'
  ) then
    if not executor_is_superuser and not exists (
      select 1 from pg_catalog.pg_roles
      where rolname = executor_role and rolcreaterole
    ) then
      raise exception
        'Creating vsee_underwriting_owner requires SUPERUSER or CREATEROLE';
    end if;
    create role vsee_underwriting_owner nologin noinherit;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'vsee_underwriting_owner'
      and not rolsuper and not rolinherit and not rolcreaterole
      and not rolcreatedb and not rolcanlogin and not rolreplication
      and not rolbypassrls
  ) or exists (
    select 1 from pg_catalog.pg_auth_members as membership
    where (
      membership.roleid = 'vsee_underwriting_owner'::pg_catalog.regrole
      or membership.member = 'vsee_underwriting_owner'::pg_catalog.regrole
    ) and not (
      not executor_is_superuser
      and membership.roleid =
        'vsee_underwriting_owner'::pg_catalog.regrole
      and membership.member = (
        select oid from pg_catalog.pg_roles where rolname = executor_role
      )
      and membership.grantor = 10
      and (select rolsuper from pg_catalog.pg_roles where oid = membership.grantor)
      and membership.admin_option
      and not membership.inherit_option and not membership.set_option
    )
  ) then
    raise exception 'vsee_underwriting_owner is not in its attested state';
  end if;
  if not executor_is_superuser then
    if not exists (
      select 1 from pg_catalog.pg_auth_members as membership
      where membership.roleid =
          'vsee_underwriting_owner'::pg_catalog.regrole
        and membership.member = (
          select oid from pg_catalog.pg_roles where rolname = executor_role
        )
        and membership.grantor = 10
      and (select rolsuper from pg_catalog.pg_roles where oid = membership.grantor)
      and membership.admin_option
        and not membership.inherit_option and not membership.set_option
    ) then
      raise exception 'The migration executor lacks the attested underwriting-owner administration grant';
    end if;
    execute pg_catalog.format(
      'grant vsee_underwriting_owner to %I with admin false, inherit true, set true',
      executor_role
    );
  end if;
end;
$underwriting_owner_prepare$;

do $registry_owner_prepare$
declare
  executor_role text := current_user;
  executor_is_superuser boolean;
begin
  select rolsuper into executor_is_superuser
  from pg_catalog.pg_roles where rolname = executor_role;
  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'vsee_registry_owner'
      and not rolsuper and not rolinherit and not rolcreaterole
      and not rolcreatedb and not rolcanlogin and not rolreplication
      and not rolbypassrls
  ) or exists (
    select 1 from pg_catalog.pg_auth_members as membership
    where (
      membership.roleid = 'vsee_registry_owner'::pg_catalog.regrole
      or membership.member = 'vsee_registry_owner'::pg_catalog.regrole
    ) and not (
      not executor_is_superuser
      and membership.roleid = 'vsee_registry_owner'::pg_catalog.regrole
      and membership.member = (
        select oid from pg_catalog.pg_roles where rolname = executor_role
      )
      and membership.grantor = 10
      and (select rolsuper from pg_catalog.pg_roles where oid = membership.grantor)
      and membership.admin_option
      and not membership.inherit_option and not membership.set_option
    )
  ) then
    raise exception 'vsee_registry_owner is not in its attested state';
  end if;
  if not executor_is_superuser then
    if not exists (
      select 1 from pg_catalog.pg_auth_members as membership
      where membership.roleid = 'vsee_registry_owner'::pg_catalog.regrole
        and membership.member = (
          select oid from pg_catalog.pg_roles where rolname = executor_role
        )
        and membership.grantor = 10
      and (select rolsuper from pg_catalog.pg_roles where oid = membership.grantor)
      and membership.admin_option
        and not membership.inherit_option and not membership.set_option
    ) then
      raise exception 'The migration executor lacks the attested registry-owner administration grant';
    end if;
    execute pg_catalog.format(
      'grant vsee_registry_owner to %I with admin false, inherit true, set true',
      executor_role
    );
  end if;
end;
$registry_owner_prepare$;

grant usage, create on schema public to vsee_underwriting_owner;

create table if not exists public.underwriting_batches (
  id text primary key,
  workspace_id text not null
    references public.workspaces(id) on delete cascade,
  scan_run_id uuid not null,
  status text not null check (
    status in ('queued', 'running', 'partial', 'completed', 'failed')
  ),
  batch_input_fingerprint text not null check (
    batch_input_fingerprint ~ '^sha256:[0-9a-f]{64}$'
  ),
  fund_policy_snapshot_id text not null,
  force_refresh boolean not null default false,
  refresh_nonce text,
  rerun_of_id text,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  constraint underwriting_batches_workspace_scan_fkey
    foreign key (workspace_id, scan_run_id)
    references public.scan_runs(workspace_id, id),
  constraint underwriting_batches_workspace_policy_fkey
    foreign key (workspace_id, fund_policy_snapshot_id)
    references public.fund_policy_versions(workspace_id, id),
  constraint underwriting_batches_workspace_rerun_fkey
    foreign key (workspace_id, rerun_of_id)
    references public.underwriting_batches(workspace_id, id),
  constraint underwriting_batches_refresh_shape_check check (
    (
      not force_refresh
      and refresh_nonce is null
      and rerun_of_id is null
    )
    or (
      force_refresh
      and btrim(coalesce(refresh_nonce, '')) <> ''
      and rerun_of_id is not null
    )
  )
);

create unique index if not exists
  underwriting_batches_idempotent_input_unique
on public.underwriting_batches (
  workspace_id, batch_input_fingerprint
)
where not force_refresh;

create unique index if not exists
  underwriting_batches_refresh_nonce_unique
on public.underwriting_batches (
  workspace_id, batch_input_fingerprint, refresh_nonce
)
where force_refresh;

create table if not exists public.underwriting_selections (
  batch_id text not null,
  workspace_id text not null,
  deal_id text not null,
  status text not null check (status in ('selected', 'not_selected')),
  rank integer,
  reason text not null check (btrim(reason) <> ''),
  created_at timestamptz not null default now(),
  primary key (batch_id, deal_id),
  constraint underwriting_selections_workspace_batch_fkey
    foreign key (workspace_id, batch_id)
    references public.underwriting_batches(workspace_id, id)
    on delete cascade,
  constraint underwriting_selections_workspace_deal_fkey
    foreign key (workspace_id, deal_id)
    references public.deals(workspace_id, id),
  constraint underwriting_selections_rank_shape_check check (
    (status = 'selected' and rank between 1 and 5)
    or (status = 'not_selected' and rank is null)
  )
);

create unique index if not exists
  underwriting_selections_selected_rank_unique
on public.underwriting_selections(batch_id, rank)
where status = 'selected';

create table if not exists public.candidate_runs (
  id text primary key,
  batch_id text not null,
  workspace_id text not null,
  deal_id text not null,
  status text not null check (
    status in (
      'queued', 'running', 'partial', 'completed', 'unavailable', 'failed'
    )
  ),
  candidate_analysis_fingerprint text not null,
  rerun_of_id text,
  worker_id text,
  lease_token text,
  lease_expires_at timestamptz,
  unavailable_reason_codes jsonb not null default '[]'::jsonb check (
    jsonb_typeof(unavailable_reason_codes) = 'array'
  ),
  public_failure_reason text,
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  unique (workspace_id, id),
  unique (batch_id, deal_id),
  constraint candidate_runs_workspace_batch_fkey
    foreign key (workspace_id, batch_id)
    references public.underwriting_batches(workspace_id, id)
    on delete cascade,
  constraint candidate_runs_workspace_deal_fkey
    foreign key (workspace_id, deal_id)
    references public.deals(workspace_id, id),
  constraint candidate_runs_workspace_rerun_fkey
    foreign key (workspace_id, rerun_of_id)
    references public.candidate_runs(workspace_id, id),
  constraint candidate_runs_lease_shape_check check (
    (
      worker_id is null
      and lease_token is null
      and lease_expires_at is null
    )
    or (
      status = 'running'
      and btrim(coalesce(worker_id, '')) <> ''
      and btrim(coalesce(lease_token, '')) <> ''
      and lease_expires_at is not null
    )
  )
);

create unique index if not exists
  candidate_runs_completed_fingerprint_unique
on public.candidate_runs(workspace_id, candidate_analysis_fingerprint)
where status = 'completed';

create index if not exists candidate_runs_claim_queue_idx
on public.candidate_runs(status, created_at, id);

create table if not exists public.candidate_checkpoints (
  candidate_run_id text not null,
  workspace_id text not null,
  stage text not null check (
    stage in (
      'evidence_pack', 'context_router', 'valuation', 'framework_lenses',
      'decision', 'narrative_drafts', 'finalization'
    )
  ),
  status text not null check (status in ('running', 'completed', 'failed')),
  artifact_fingerprint text not null,
  public_reason text,
  saved_at timestamptz not null,
  primary key (candidate_run_id, stage),
  constraint candidate_checkpoints_workspace_candidate_fkey
    foreign key (workspace_id, candidate_run_id)
    references public.candidate_runs(workspace_id, id)
    on delete cascade
);

create table if not exists public.evidence_packs (
  workspace_id text not null,
  candidate_run_id text not null,
  artifact_id text not null,
  version integer not null check (version > 0),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  primary key (workspace_id, candidate_run_id),
  constraint evidence_packs_workspace_candidate_fkey
    foreign key (workspace_id, candidate_run_id)
    references public.candidate_runs(workspace_id, id)
);

create table if not exists public.candidate_context_snapshots (
  workspace_id text not null,
  candidate_run_id text not null,
  artifact_id text not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  primary key (workspace_id, candidate_run_id),
  constraint candidate_context_snapshots_candidate_fkey
    foreign key (workspace_id, candidate_run_id)
    references public.candidate_runs(workspace_id, id)
);

create table if not exists public.scenario_models (
  workspace_id text not null,
  candidate_run_id text not null,
  artifact_id text not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  primary key (workspace_id, candidate_run_id),
  constraint scenario_models_workspace_candidate_fkey
    foreign key (workspace_id, candidate_run_id)
    references public.candidate_runs(workspace_id, id)
);

create table if not exists public.underwriting_calculations (
  workspace_id text not null,
  candidate_run_id text not null,
  artifact_id text not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  primary key (workspace_id, candidate_run_id, artifact_id),
  constraint underwriting_calculations_candidate_fkey
    foreign key (workspace_id, candidate_run_id)
    references public.candidate_runs(workspace_id, id)
);

create table if not exists public.framework_judgment_artifacts (
  workspace_id text not null,
  candidate_run_id text not null,
  artifact_id text not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  primary key (workspace_id, candidate_run_id, artifact_id),
  constraint framework_judgment_artifacts_candidate_fkey
    foreign key (workspace_id, candidate_run_id)
    references public.candidate_runs(workspace_id, id)
);

create table if not exists public.framework_disagreement_artifacts (
  workspace_id text not null,
  candidate_run_id text not null,
  artifact_id text not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  primary key (workspace_id, candidate_run_id, artifact_id),
  constraint framework_disagreement_artifacts_candidate_fkey
    foreign key (workspace_id, candidate_run_id)
    references public.candidate_runs(workspace_id, id)
);

create table if not exists public.valuation_evaluations (
  workspace_id text not null,
  candidate_run_id text not null,
  artifact_id text not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  primary key (workspace_id, candidate_run_id),
  constraint valuation_evaluations_workspace_candidate_fkey
    foreign key (workspace_id, candidate_run_id)
    references public.candidate_runs(workspace_id, id)
);

create table if not exists public.final_syntheses (
  workspace_id text not null,
  candidate_run_id text not null,
  artifact_id text not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  primary key (workspace_id, candidate_run_id),
  constraint final_syntheses_workspace_candidate_fkey
    foreign key (workspace_id, candidate_run_id)
    references public.candidate_runs(workspace_id, id)
);

create table if not exists public.underwriting_narratives (
  workspace_id text not null,
  candidate_run_id text not null,
  body text not null check (btrim(body) <> ''),
  created_at timestamptz not null default now(),
  primary key (workspace_id, candidate_run_id),
  constraint underwriting_narratives_workspace_candidate_fkey
    foreign key (workspace_id, candidate_run_id)
    references public.candidate_runs(workspace_id, id)
);

create table if not exists public.action_drafts (
  workspace_id text not null,
  candidate_run_id text not null,
  artifact_id text not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  primary key (workspace_id, candidate_run_id, artifact_id),
  constraint action_drafts_workspace_candidate_fkey
    foreign key (workspace_id, candidate_run_id)
    references public.candidate_runs(workspace_id, id)
);

create table if not exists public.underwriting_claim_edges (
  workspace_id text not null,
  candidate_run_id text not null,
  claim_item_id text not null,
  dependency_item_id text not null,
  dependency_type text not null check (
    dependency_type in (
      'fact', 'assumption', 'calculation', 'framework_judgment',
      'policy_ref', 'benchmark_ref', 'framework_ref'
    )
  ),
  created_at timestamptz not null default now(),
  primary key (
    workspace_id, candidate_run_id, claim_item_id,
    dependency_item_id, dependency_type
  ),
  constraint underwriting_claim_edges_workspace_candidate_fkey
    foreign key (workspace_id, candidate_run_id)
    references public.candidate_runs(workspace_id, id)
);

create table if not exists public.candidate_version_snapshots (
  workspace_id text not null,
  candidate_run_id text not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  primary key (workspace_id, candidate_run_id),
  constraint candidate_version_snapshots_workspace_candidate_fkey
    foreign key (workspace_id, candidate_run_id)
    references public.candidate_runs(workspace_id, id)
);

create or replace function public.reject_immutable_underwriting_artifact()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is immutable after candidate finalization', tg_table_name;
end;
$$;

do $$
declare
  artifact_table text;
begin
  foreach artifact_table in array array[
    'evidence_packs',
    'candidate_context_snapshots',
    'scenario_models',
    'underwriting_calculations',
    'framework_judgment_artifacts',
    'framework_disagreement_artifacts',
    'valuation_evaluations',
    'final_syntheses',
    'underwriting_narratives',
    'action_drafts',
    'underwriting_claim_edges',
    'candidate_version_snapshots'
  ]
  loop
    execute format(
      'drop trigger if exists %I on public.%I',
      artifact_table || '_immutable',
      artifact_table
    );
    execute format(
      'create trigger %I before update or delete on public.%I for each row execute function public.reject_immutable_underwriting_artifact()',
      artifact_table || '_immutable',
      artifact_table
    );
  end loop;
end;
$$;

create or replace function public.refresh_underwriting_batch_status(
  p_batch_id text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  candidate_count integer;
  terminal_count integer;
  completed_count integer;
  failed_count integer;
  selection_count integer;
  selected_count integer;
begin
  select
    count(*)::integer,
    count(*) filter (
      where status in ('completed', 'unavailable', 'failed')
    )::integer,
    count(*) filter (where status = 'completed')::integer,
    count(*) filter (where status in ('unavailable', 'failed'))::integer
  into candidate_count, terminal_count, completed_count, failed_count
  from public.candidate_runs
  where batch_id = p_batch_id;

  select
    count(*)::integer,
    count(*) filter (where status = 'selected')::integer
  into selection_count, selected_count
  from public.underwriting_selections
  where batch_id = p_batch_id;

  update public.underwriting_batches
  set status = case
    when candidate_count = 0
      and selection_count > 0
      and selected_count = 0
      then 'completed'
    when candidate_count = 0 then status
    when terminal_count < candidate_count then 'running'
    when completed_count = candidate_count then 'completed'
    when failed_count = candidate_count then 'failed'
    else 'partial'
  end
  where id = p_batch_id;
end;
$$;

create or replace function public.create_or_reuse_underwriting_batch(
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_workspace_id text := btrim(p_payload ->> 'workspaceId');
  target_fingerprint text := btrim(p_payload ->> 'batchInputFingerprint');
  target_force boolean := coalesce(
    (p_payload ->> 'forceRefresh')::boolean,
    false
  );
  target_nonce text := nullif(btrim(p_payload ->> 'refreshNonce'), '');
  target_rerun text := nullif(btrim(p_payload ->> 'rerunOfId'), '');
  target public.underwriting_batches%rowtype;
begin
  if target_workspace_id is null or target_workspace_id = ''
    or target_fingerprint !~ '^sha256:[0-9a-f]{64}$'
  then
    raise exception 'A workspace and canonical batch fingerprint are required';
  end if;
  if (
    target_force and (target_nonce is null or target_rerun is null)
  ) or (
    not target_force and (target_nonce is not null or target_rerun is not null)
  ) then
    raise exception 'Refresh nonce and rerun parent must match forceRefresh';
  end if;

  if target_force then
    select * into target
    from public.underwriting_batches
    where workspace_id = target_workspace_id
      and batch_input_fingerprint = target_fingerprint
      and force_refresh
      and refresh_nonce = target_nonce;
  else
    select * into target
    from public.underwriting_batches
    where workspace_id = target_workspace_id
      and batch_input_fingerprint = target_fingerprint
      and not force_refresh;
  end if;
  if found then
    return jsonb_build_object(
      'id', target.id,
      'workspaceId', target.workspace_id,
      'scanRunId', target.scan_run_id,
      'status', target.status,
      'batchInputFingerprint', target.batch_input_fingerprint,
      'fundPolicySnapshotId', target.fund_policy_snapshot_id,
      'rerunOfId', target.rerun_of_id,
      'createdAt', public.canonical_utc_iso_milliseconds(target.created_at)
    );
  end if;

  if target_force and not exists (
    select 1 from public.underwriting_batches
    where workspace_id = target_workspace_id
      and id = target_rerun
      and batch_input_fingerprint = target_fingerprint
  ) then
    raise exception 'A forced refresh must rerun the same batch input';
  end if;

  insert into public.underwriting_batches (
    id, workspace_id, scan_run_id, status, batch_input_fingerprint,
    fund_policy_snapshot_id, force_refresh, refresh_nonce, rerun_of_id
  ) values (
    gen_random_uuid()::text,
    target_workspace_id,
    (p_payload ->> 'scanRunId')::uuid,
    'queued',
    target_fingerprint,
    btrim(p_payload ->> 'fundPolicySnapshotId'),
    target_force,
    target_nonce,
    target_rerun
  )
  returning * into target;

  return jsonb_build_object(
    'id', target.id,
    'workspaceId', target.workspace_id,
    'scanRunId', target.scan_run_id,
    'status', target.status,
    'batchInputFingerprint', target.batch_input_fingerprint,
    'fundPolicySnapshotId', target.fund_policy_snapshot_id,
    'rerunOfId', target.rerun_of_id,
    'createdAt', public.canonical_utc_iso_milliseconds(target.created_at)
  );
end;
$$;

create or replace function public.save_underwriting_selections(
  p_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_batch public.underwriting_batches%rowtype;
  item jsonb;
  target_rank integer;
  target_status text;
begin
  select * into target_batch
  from public.underwriting_batches
  where id = btrim(p_payload ->> 'batchId')
  for update;
  if not found then raise exception 'Underwriting batch not found'; end if;
  if jsonb_typeof(p_payload -> 'selections') <> 'array' then
    raise exception 'Selections must be an array';
  end if;

  for item in select value from jsonb_array_elements(
    p_payload -> 'selections'
  )
  loop
    target_rank := nullif(item ->> 'rank', '')::integer;
    target_status := case
      when item ->> 'status' = 'selected'
        and target_rank between 1 and 5
      then 'selected'
      else 'not_selected'
    end;
    if target_status = 'not_selected' then target_rank := null; end if;
    insert into public.underwriting_selections (
      batch_id, workspace_id, deal_id, status, rank, reason
    ) values (
      target_batch.id,
      target_batch.workspace_id,
      btrim(item ->> 'dealId'),
      target_status,
      target_rank,
      btrim(item ->> 'reason')
    )
    on conflict (batch_id, deal_id) do update set
      status = excluded.status,
      rank = excluded.rank,
      reason = excluded.reason;
  end loop;
  perform public.refresh_underwriting_batch_status(target_batch.id);
end;
$$;

create or replace function public.create_selected_underwriting_candidates(
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_batch public.underwriting_batches%rowtype;
  target_deal_id text;
  target_candidate_id text;
begin
  select * into target_batch
  from public.underwriting_batches
  where id = btrim(p_payload ->> 'batchId')
  for update;
  if not found then raise exception 'Underwriting batch not found'; end if;
  if jsonb_typeof(p_payload -> 'dealIds') <> 'array' then
    raise exception 'Deal ids must be an array';
  end if;

  for target_deal_id in
    select btrim(value #>> '{}')
    from jsonb_array_elements(p_payload -> 'dealIds')
  loop
    if exists (
      select 1 from public.underwriting_selections
      where batch_id = target_batch.id
        and deal_id = target_deal_id
        and status = 'selected'
        and rank between 1 and 5
    ) then
      target_candidate_id := gen_random_uuid()::text;
      insert into public.candidate_runs (
        id, batch_id, workspace_id, deal_id, status,
        candidate_analysis_fingerprint, rerun_of_id
      ) values (
        target_candidate_id,
        target_batch.id,
        target_batch.workspace_id,
        target_deal_id,
        'queued',
        'pending:' || target_candidate_id,
        (
          select previous.id
          from public.candidate_runs as previous
          where previous.batch_id = target_batch.rerun_of_id
            and previous.deal_id = target_deal_id
          limit 1
        )
      )
      on conflict (batch_id, deal_id) do nothing;
    end if;
  end loop;
  perform public.refresh_underwriting_batch_status(target_batch.id);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', candidate.id,
      'batchId', candidate.batch_id,
      'workspaceId', candidate.workspace_id,
      'dealId', candidate.deal_id,
      'status', candidate.status,
      'candidateAnalysisFingerprint',
        candidate.candidate_analysis_fingerprint,
      'rerunOfId', candidate.rerun_of_id,
      'createdAt',
        public.canonical_utc_iso_milliseconds(candidate.created_at),
      'finalizedAt', case
        when candidate.finalized_at is null then null
        else public.canonical_utc_iso_milliseconds(candidate.finalized_at)
      end
    ) order by selection.rank)
    from public.candidate_runs as candidate
    join public.underwriting_selections as selection
      on selection.batch_id = candidate.batch_id
      and selection.deal_id = candidate.deal_id
    where candidate.batch_id = target_batch.id
      and selection.status = 'selected'
  ), '[]'::jsonb);
end;
$$;

create or replace function public.claim_next_underwriting_candidate(
  p_worker_id text,
  p_lease_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.candidate_runs%rowtype;
  target_token text;
begin
  if btrim(coalesce(p_worker_id, '')) = ''
    or p_lease_seconds is null
    or p_lease_seconds <= 0
  then
    raise exception 'A worker and positive lease duration are required';
  end if;
  select * into target
  from public.candidate_runs
  where status = 'queued'
    or (
      status = 'running'
      and (lease_expires_at is null or lease_expires_at <= now())
    )
  order by created_at, id
  for update skip locked
  limit 1;
  if not found then return null; end if;

  target_token := gen_random_uuid()::text;
  update public.candidate_runs
  set status = 'running',
      worker_id = btrim(p_worker_id),
      lease_token = target_token,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds)
  where id = target.id
  returning * into target;
  perform public.refresh_underwriting_batch_status(target.batch_id);
  return jsonb_build_object(
    'candidate', jsonb_build_object(
      'id', target.id,
      'batchId', target.batch_id,
      'workspaceId', target.workspace_id,
      'dealId', target.deal_id,
      'status', target.status,
      'candidateAnalysisFingerprint',
        target.candidate_analysis_fingerprint,
      'rerunOfId', target.rerun_of_id,
      'createdAt', public.canonical_utc_iso_milliseconds(target.created_at),
      'finalizedAt', null
    ),
    'leaseToken', target_token,
    'leaseExpiresAt',
      public.canonical_utc_iso_milliseconds(target.lease_expires_at)
  );
end;
$$;

create or replace function public.save_underwriting_checkpoint(
  p_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.candidate_runs%rowtype;
  checkpoint jsonb := p_payload -> 'checkpoint';
begin
  select * into target
  from public.candidate_runs
  where id = btrim(checkpoint ->> 'candidateRunId')
  for update;
  if not found
    or target.status <> 'running'
    or target.worker_id <> btrim(p_payload ->> 'workerId')
    or target.lease_token <> btrim(p_payload ->> 'leaseToken')
    or target.lease_expires_at <= now()
  then
    raise exception 'Candidate checkpoint lease does not match';
  end if;
  insert into public.candidate_checkpoints (
    candidate_run_id, workspace_id, stage, status,
    artifact_fingerprint, public_reason, saved_at
  ) values (
    target.id,
    target.workspace_id,
    btrim(checkpoint ->> 'stage'),
    btrim(checkpoint ->> 'status'),
    btrim(checkpoint ->> 'artifactFingerprint'),
    checkpoint ->> 'publicReason',
    (checkpoint ->> 'savedAt')::timestamptz
  )
  on conflict (candidate_run_id, stage) do update set
    status = excluded.status,
    artifact_fingerprint = excluded.artifact_fingerprint,
    public_reason = excluded.public_reason,
    saved_at = excluded.saved_at;
end;
$$;

create or replace function public.mark_candidate_underwriting_unavailable(
  p_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_batch_id text;
begin
  update public.candidate_runs
  set status = 'unavailable',
      unavailable_reason_codes = p_payload -> 'reasonCodes',
      finalized_at = now(),
      worker_id = null,
      lease_token = null,
      lease_expires_at = null
  where id = btrim(p_payload ->> 'candidateRunId')
    and status in ('queued', 'running', 'partial')
  returning batch_id into target_batch_id;
  if target_batch_id is null then
    raise exception 'Candidate cannot be marked unavailable';
  end if;
  perform public.refresh_underwriting_batch_status(target_batch_id);
end;
$$;

create or replace function public.mark_candidate_underwriting_failed(
  p_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_batch_id text;
begin
  update public.candidate_runs
  set status = 'failed',
      public_failure_reason = btrim(p_payload ->> 'publicReason'),
      finalized_at = now(),
      worker_id = null,
      lease_token = null,
      lease_expires_at = null
  where id = btrim(p_payload ->> 'candidateRunId')
    and status in ('queued', 'running', 'partial')
  returning batch_id into target_batch_id;
  if target_batch_id is null then
    raise exception 'Candidate cannot be marked failed';
  end if;
  perform public.refresh_underwriting_batch_status(target_batch_id);
end;
$$;

create or replace function public.assert_underwriting_claim_edge(
  p_payload jsonb,
  p_edge jsonb,
  p_expected_claim_item_id text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  dependency_id text := btrim(p_edge ->> 'dependencyItemId');
  dependency_type text := btrim(p_edge ->> 'dependencyType');
  dependency_exists boolean := false;
begin
  if btrim(p_edge ->> 'claimItemId') <> p_expected_claim_item_id
    or coalesce(dependency_id, '') = ''
  then
    raise exception 'Claim edge ownership or dependency is invalid';
  end if;

  dependency_exists := case dependency_type
    when 'fact' then exists (
      select 1
      from jsonb_array_elements(
        coalesce(p_payload -> 'evidencePack' -> 'facts', '[]'::jsonb)
      ) as dependency
      where dependency ->> 'id' = dependency_id
    )
    when 'assumption' then exists (
      select 1
      from jsonb_array_elements(
        coalesce(p_payload -> 'evidencePack' -> 'assumptions', '[]'::jsonb)
      ) as dependency
      where dependency ->> 'id' = dependency_id
    )
    when 'calculation' then exists (
      select 1
      from jsonb_array_elements(
        coalesce(p_payload -> 'calculations', '[]'::jsonb)
      ) as dependency
      where dependency ->> 'id' = dependency_id
    )
    when 'framework_judgment' then exists (
      select 1
      from jsonb_array_elements(
        coalesce(p_payload -> 'judgments', '[]'::jsonb)
      ) as dependency
      where dependency ->> 'id' = dependency_id
    )
    when 'policy_ref' then dependency_id in (
      p_payload -> 'versionSnapshot' ->> 'fundPolicyId',
      p_payload -> 'versionSnapshot' ->> 'criticalEvidenceProfileId',
      p_payload -> 'versionSnapshot' ->> 'valuationMethodPolicyId',
      p_payload -> 'versionSnapshot' ->> 'decisionPolicyId'
    )
    when 'benchmark_ref' then dependency_id =
      p_payload -> 'versionSnapshot' ->> 'benchmarkPackId'
    when 'framework_ref' then dependency_id =
      p_payload -> 'versionSnapshot' ->> 'frameworkPackId'
      or exists (
        select 1
        from jsonb_array_elements(
          coalesce(p_payload -> 'judgments', '[]'::jsonb)
        ) as dependency
        where dependency ->> 'frameworkCardId' = dependency_id
      )
    else false
  end;

  if not dependency_exists then
    raise exception
      'Typed claim dependency % (%) does not resolve',
      dependency_id,
      dependency_type;
  end if;
end;
$$;

create or replace function public.finalize_candidate_underwriting(jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p_payload alias for $1;
  target public.candidate_runs%rowtype;
  target_batch public.underwriting_batches%rowtype;
  target_fingerprint text := btrim(
    p_payload ->> 'candidateAnalysisFingerprint'
  );
  evidence_pack jsonb := p_payload -> 'evidencePack';
  context_snapshot jsonb := p_payload -> 'context';
  scenario_model jsonb := p_payload -> 'scenarioModel';
  valuation jsonb := p_payload -> 'valuation';
  decision_result jsonb := p_payload -> 'decision';
  version_snapshot jsonb := p_payload -> 'versionSnapshot';
  item jsonb;
  edge jsonb;
  input_ref jsonb;
  input_ref_exists boolean;
  fund_policy_values jsonb;
begin
  select * into target
  from public.candidate_runs
  where id = btrim(p_payload ->> 'candidateRunId')
  for update;
  if not found
    or target.status <> 'running'
    or target.worker_id <> btrim(p_payload ->> 'workerId')
    or target.lease_token <> btrim(p_payload ->> 'leaseToken')
    or target.lease_expires_at <= now()
  then
    raise exception 'Candidate finalization lease does not match';
  end if;
  select * into target_batch
  from public.underwriting_batches
  where id = target.batch_id
    and workspace_id = target.workspace_id;
  if not found then
    raise exception 'Candidate batch does not exist';
  end if;
  if target_fingerprint !~ '^sha256:[0-9a-f]{64}$' then
    raise exception 'A canonical candidate fingerprint is required';
  end if;
  if jsonb_typeof(evidence_pack) <> 'object'
    or evidence_pack ->> 'workspaceId' <> target.workspace_id
    or nullif(btrim(evidence_pack ->> 'dealId'), '')
      is distinct from target.deal_id
    or jsonb_typeof(context_snapshot) <> 'object'
    or jsonb_typeof(scenario_model) <> 'object'
    or jsonb_typeof(p_payload -> 'calculationClaimEdges') <> 'array'
    or scenario_model ->> 'candidateRunId' <> target.id
    or jsonb_typeof(valuation) <> 'object'
    or jsonb_typeof(decision_result) <> 'object'
    or jsonb_typeof(version_snapshot) <> 'object'
    or btrim(coalesce(p_payload ->> 'narrative', '')) = ''
  then
    raise exception 'Finalized artifact identity or shape is invalid';
  end if;
  if context_snapshot ->> 'criticalEvidenceProfileId'
      <> version_snapshot ->> 'criticalEvidenceProfileId'
    or context_snapshot ->> 'benchmarkPackId'
      is distinct from version_snapshot ->> 'benchmarkPackId'
    or context_snapshot ->> 'valuationMethodPolicyId'
      <> version_snapshot ->> 'valuationMethodPolicyId'
    or context_snapshot ->> 'decisionPolicyId'
      <> version_snapshot ->> 'decisionPolicyId'
    or context_snapshot ->> 'frameworkPackId'
      <> version_snapshot ->> 'frameworkPackId'
    or target_batch.fund_policy_snapshot_id
      <> version_snapshot ->> 'fundPolicyId'
  then
    raise exception 'Version snapshot does not match resolved context';
  end if;
  select values into fund_policy_values
  from public.fund_policy_versions
  where workspace_id = target.workspace_id
    and id = version_snapshot ->> 'fundPolicyId';
  if not found then
    raise exception 'Pinned Fund Policy snapshot does not exist';
  end if;

  insert into public.evidence_packs (
    workspace_id, candidate_run_id, artifact_id, version, payload
  ) values (
    target.workspace_id,
    target.id,
    btrim(evidence_pack ->> 'id'),
    (evidence_pack ->> 'version')::integer,
    evidence_pack
  );
  insert into public.candidate_context_snapshots (
    workspace_id, candidate_run_id, artifact_id, payload
  ) values (
    target.workspace_id,
    target.id,
    btrim(context_snapshot ->> 'id'),
    context_snapshot
  );
  insert into public.scenario_models (
    workspace_id, candidate_run_id, artifact_id, payload
  ) values (
    target.workspace_id,
    target.id,
    btrim(scenario_model ->> 'id'),
    scenario_model
  );

  for item in select value from jsonb_array_elements(
    coalesce(p_payload -> 'calculations', '[]'::jsonb)
  )
  loop
    insert into public.underwriting_calculations (
      workspace_id, candidate_run_id, artifact_id, payload
    ) values (
      target.workspace_id, target.id, btrim(item ->> 'id'), item
    );
    for input_ref in select value from jsonb_array_elements(
      coalesce(item -> 'inputRefs', '[]'::jsonb)
    )
    loop
      input_ref_exists := case btrim(input_ref ->> 'type')
        when 'fact' then exists (
          select 1
          from jsonb_array_elements(
            coalesce(evidence_pack -> 'facts', '[]'::jsonb)
          ) as dependency
          where dependency ->> 'id' = btrim(input_ref ->> 'itemId')
        )
        when 'assumption' then exists (
          select 1
          from jsonb_array_elements(
            coalesce(evidence_pack -> 'assumptions', '[]'::jsonb)
          ) as dependency
          where dependency ->> 'id' = btrim(input_ref ->> 'itemId')
        )
        when 'policy' then
          btrim(input_ref ->> 'itemId') in (
            version_snapshot ->> 'fundPolicyId',
            version_snapshot ->> 'criticalEvidenceProfileId',
            version_snapshot ->> 'valuationMethodPolicyId',
            version_snapshot ->> 'decisionPolicyId'
          )
          or (
            btrim(input_ref ->> 'itemId') = 'policy:initialCheckMax'
            and fund_policy_values ->> 'initialCheckMax'
              = input_ref ->> 'value'
          )
          or (
            btrim(input_ref ->> 'itemId')
              = 'policy:acceptableFutureDilution'
            and fund_policy_values ->> 'acceptableFutureDilution'
              = input_ref ->> 'value'
          )
          or (
            btrim(input_ref ->> 'itemId')
              = (
                'policy:returnTargets.'
                || (context_snapshot ->> 'stage')
                || '.grossMoic'
              )
            and fund_policy_values #>> array[
              'returnTargets',
              (context_snapshot ->> 'stage'),
              'grossMoic'
            ] = input_ref ->> 'value'
          )
          or (
            btrim(input_ref ->> 'itemId')
              = (
                'policy:returnTargets.'
                || (context_snapshot ->> 'stage')
                || '.horizonYears'
              )
            and fund_policy_values #>> array[
              'returnTargets',
              (context_snapshot ->> 'stage'),
              'horizonYears'
            ] = input_ref ->> 'value'
          )
        when 'benchmark' then
          exists (
            select 1
            from jsonb_array_elements(
              coalesce(evidence_pack -> 'assumptions', '[]'::jsonb)
            ) as dependency
            where dependency ->> 'id' = btrim(input_ref ->> 'itemId')
              and dependency ->> 'value' = input_ref ->> 'value'
              and dependency ->> 'provenanceOrigin' = 'benchmark'
              and dependency -> 'inputRefIds' = jsonb_build_array(
                version_snapshot ->> 'benchmarkPackId'
              )
          )
          and exists (
            select 1
            from public.benchmark_packs
            where id = version_snapshot ->> 'benchmarkPackId'
          )
        else false
      end;
      if not input_ref_exists then
        raise exception
          'Calculation input % (%) does not resolve',
          btrim(input_ref ->> 'itemId'),
          btrim(input_ref ->> 'type');
      end if;
    end loop;
  end loop;
  for edge in select value from jsonb_array_elements(
    coalesce(p_payload -> 'calculationClaimEdges', '[]'::jsonb)
  )
  loop
    if btrim(edge ->> 'dependencyType') <> 'calculation'
      or not exists (
        select 1
        from jsonb_array_elements(
          coalesce(p_payload -> 'calculations', '[]'::jsonb)
        ) as calculation
        where calculation ->> 'id' = btrim(edge ->> 'claimItemId')
      )
      or not exists (
        select 1
        from jsonb_array_elements(
          coalesce(p_payload -> 'calculations', '[]'::jsonb)
        ) as calculation
        where calculation ->> 'id' = btrim(edge ->> 'dependencyItemId')
      )
    then
      raise exception
        'Calculation claim edge must connect two saved calculations';
    end if;
    insert into public.underwriting_claim_edges (
      workspace_id, candidate_run_id, claim_item_id,
      dependency_item_id, dependency_type
    ) values (
      target.workspace_id,
      target.id,
      btrim(edge ->> 'claimItemId'),
      btrim(edge ->> 'dependencyItemId'),
      'calculation'
    );
  end loop;
  for item in select value from jsonb_array_elements(
    coalesce(p_payload -> 'judgments', '[]'::jsonb)
  )
  loop
    insert into public.framework_judgment_artifacts (
      workspace_id, candidate_run_id, artifact_id, payload
    ) values (
      target.workspace_id, target.id, btrim(item ->> 'id'), item
    );
    for edge in select value from jsonb_array_elements(
      coalesce(item -> 'claimEdges', '[]'::jsonb)
    )
    loop
      perform public.assert_underwriting_claim_edge(
        p_payload,
        edge,
        btrim(item ->> 'id')
      );
      insert into public.underwriting_claim_edges (
        workspace_id, candidate_run_id, claim_item_id,
        dependency_item_id, dependency_type
      ) values (
        target.workspace_id,
        target.id,
        btrim(edge ->> 'claimItemId'),
        btrim(edge ->> 'dependencyItemId'),
        btrim(edge ->> 'dependencyType')
      );
    end loop;
  end loop;
  for item in select value from jsonb_array_elements(
    coalesce(p_payload -> 'disagreements', '[]'::jsonb)
  )
  loop
    insert into public.framework_disagreement_artifacts (
      workspace_id, candidate_run_id, artifact_id, payload
    ) values (
      target.workspace_id, target.id, btrim(item ->> 'id'), item
    );
  end loop;
  insert into public.valuation_evaluations (
    workspace_id, candidate_run_id, artifact_id, payload
  ) values (
    target.workspace_id,
    target.id,
    btrim(valuation ->> 'id'),
    valuation
  );
  insert into public.final_syntheses (
    workspace_id, candidate_run_id, artifact_id, payload
  ) values (
    target.workspace_id,
    target.id,
    btrim(decision_result ->> 'id'),
    decision_result
  );
  for edge in select value from jsonb_array_elements(
    coalesce(decision_result -> 'claimEdges', '[]'::jsonb)
  )
  loop
    perform public.assert_underwriting_claim_edge(
      p_payload,
      edge,
      btrim(decision_result ->> 'id')
    );
    insert into public.underwriting_claim_edges (
      workspace_id, candidate_run_id, claim_item_id,
      dependency_item_id, dependency_type
    ) values (
      target.workspace_id,
      target.id,
      btrim(edge ->> 'claimItemId'),
      btrim(edge ->> 'dependencyItemId'),
      btrim(edge ->> 'dependencyType')
    );
  end loop;
  insert into public.underwriting_narratives (
    workspace_id, candidate_run_id, body
  ) values (
    target.workspace_id, target.id, p_payload ->> 'narrative'
  );
  for item in select value from jsonb_array_elements(
    coalesce(p_payload -> 'actionDrafts', '[]'::jsonb)
  )
  loop
    if item ->> 'workspaceId' <> target.workspace_id
      or item ->> 'candidateRunId' <> target.id
    then
      raise exception 'Action draft identity does not match candidate';
    end if;
    insert into public.action_drafts (
      workspace_id, candidate_run_id, artifact_id, payload
    ) values (
      target.workspace_id, target.id, btrim(item ->> 'id'), item
    );
  end loop;
  insert into public.candidate_version_snapshots (
    workspace_id, candidate_run_id, payload
  ) values (
    target.workspace_id, target.id, version_snapshot
  );

  update public.candidate_runs
  set status = 'completed',
      candidate_analysis_fingerprint = target_fingerprint,
      finalized_at = now(),
      worker_id = null,
      lease_token = null,
      lease_expires_at = null
  where id = target.id
  returning * into target;
  perform public.refresh_underwriting_batch_status(target.batch_id);

  return jsonb_build_object(
    'id', target.id,
    'batchId', target.batch_id,
    'workspaceId', target.workspace_id,
    'dealId', target.deal_id,
    'status', target.status,
    'candidateAnalysisFingerprint',
      target.candidate_analysis_fingerprint,
    'rerunOfId', target.rerun_of_id,
    'createdAt', public.canonical_utc_iso_milliseconds(target.created_at),
    'finalizedAt',
      public.canonical_utc_iso_milliseconds(target.finalized_at)
  );
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'underwriting_batches',
    'underwriting_selections',
    'candidate_runs',
    'candidate_checkpoints',
    'evidence_packs',
    'candidate_context_snapshots',
    'scenario_models',
    'underwriting_calculations',
    'framework_judgment_artifacts',
    'framework_disagreement_artifacts',
    'valuation_evaluations',
    'final_syntheses',
    'underwriting_narratives',
    'action_drafts',
    'underwriting_claim_edges',
    'candidate_version_snapshots'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all privileges on table public.%I from public', table_name);
    execute format(
      'grant select, insert, update, delete on table public.%I to vsee_underwriting_owner',
      table_name
    );
    execute format(
      'drop policy if exists %I on public.%I',
      table_name || '_underwriting_owner',
      table_name
    );
    execute format(
      'create policy %I on public.%I for all to vsee_underwriting_owner using (true) with check (true)',
      table_name || '_underwriting_owner',
      table_name
    );
  end loop;
end;
$$;

grant usage on schema public to vsee_underwriting_owner;
grant select on public.scan_runs, public.deals, public.benchmark_packs,
  public.fund_policy_versions to vsee_underwriting_owner;
drop policy if exists fund_policy_versions_underwriting_owner
  on public.fund_policy_versions;
create policy fund_policy_versions_underwriting_owner
  on public.fund_policy_versions
  for select
  to vsee_underwriting_owner
  using (true);
grant execute on function public.canonical_utc_iso_milliseconds(timestamptz)
  to vsee_underwriting_owner;
grant execute on function public.refresh_underwriting_batch_status(text)
  to vsee_underwriting_owner;
grant execute on function
  public.assert_underwriting_claim_edge(jsonb, jsonb, text)
  to vsee_underwriting_owner;

alter function public.create_or_reuse_underwriting_batch(jsonb)
  owner to vsee_underwriting_owner;
alter function public.save_underwriting_selections(jsonb)
  owner to vsee_underwriting_owner;
alter function public.create_selected_underwriting_candidates(jsonb)
  owner to vsee_underwriting_owner;
alter function public.claim_next_underwriting_candidate(text, integer)
  owner to vsee_underwriting_owner;
alter function public.save_underwriting_checkpoint(jsonb)
  owner to vsee_underwriting_owner;
alter function public.mark_candidate_underwriting_unavailable(jsonb)
  owner to vsee_underwriting_owner;
alter function public.mark_candidate_underwriting_failed(jsonb)
  owner to vsee_underwriting_owner;
alter function public.assert_underwriting_claim_edge(jsonb, jsonb, text)
  owner to vsee_underwriting_owner;
alter function public.finalize_candidate_underwriting(jsonb)
  owner to vsee_underwriting_owner;

revoke all on function public.create_or_reuse_underwriting_batch(jsonb)
  from public;
revoke all on function public.save_underwriting_selections(jsonb) from public;
revoke all on function
  public.create_selected_underwriting_candidates(jsonb) from public;
revoke all on function
  public.claim_next_underwriting_candidate(text, integer) from public;
revoke all on function public.save_underwriting_checkpoint(jsonb) from public;
revoke all on function
  public.mark_candidate_underwriting_unavailable(jsonb) from public;
revoke all on function
  public.mark_candidate_underwriting_failed(jsonb) from public;
revoke all on function
  public.assert_underwriting_claim_edge(jsonb, jsonb, text) from public;
revoke all on function public.finalize_candidate_underwriting(jsonb)
  from public;
revoke all on function public.refresh_underwriting_batch_status(text)
  from public;

do $$
declare
  restricted_role text;
  table_name text;
begin
  for restricted_role in
    select rolname from pg_roles
    where rolname in ('anon', 'authenticated')
  loop
    foreach table_name in array array[
      'underwriting_batches',
      'underwriting_selections',
      'candidate_runs',
      'candidate_checkpoints',
      'evidence_packs',
      'candidate_context_snapshots',
      'scenario_models',
      'underwriting_calculations',
      'framework_judgment_artifacts',
      'framework_disagreement_artifacts',
      'valuation_evaluations',
      'final_syntheses',
      'underwriting_narratives',
      'action_drafts',
      'underwriting_claim_edges',
      'candidate_version_snapshots'
    ]
    loop
      execute format(
        'revoke all privileges on table public.%I from %I',
        table_name,
        restricted_role
      );
    end loop;
    execute format(
      'revoke all on function public.create_or_reuse_underwriting_batch(jsonb) from %I',
      restricted_role
    );
    execute format(
      'revoke all on function public.save_underwriting_selections(jsonb) from %I',
      restricted_role
    );
    execute format(
      'revoke all on function public.create_selected_underwriting_candidates(jsonb) from %I',
      restricted_role
    );
    execute format(
      'revoke all on function public.claim_next_underwriting_candidate(text, integer) from %I',
      restricted_role
    );
    execute format(
      'revoke all on function public.save_underwriting_checkpoint(jsonb) from %I',
      restricted_role
    );
    execute format(
      'revoke all on function public.mark_candidate_underwriting_unavailable(jsonb) from %I',
      restricted_role
    );
    execute format(
      'revoke all on function public.mark_candidate_underwriting_failed(jsonb) from %I',
      restricted_role
    );
    execute format(
      'revoke all on function public.assert_underwriting_claim_edge(jsonb, jsonb, text) from %I',
      restricted_role
    );
    execute format(
      'revoke all on function public.finalize_candidate_underwriting(jsonb) from %I',
      restricted_role
    );
  end loop;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant usage on schema public to service_role;
    foreach table_name in array array[
      'underwriting_batches',
      'underwriting_selections',
      'candidate_runs',
      'candidate_checkpoints',
      'evidence_packs',
      'candidate_context_snapshots',
      'scenario_models',
      'underwriting_calculations',
      'framework_judgment_artifacts',
      'framework_disagreement_artifacts',
      'valuation_evaluations',
      'final_syntheses',
      'underwriting_narratives',
      'action_drafts',
      'underwriting_claim_edges',
      'candidate_version_snapshots'
    ]
    loop
      execute format(
        'revoke all privileges on table public.%I from service_role',
        table_name
      );
      execute format(
        'grant select on table public.%I to service_role',
        table_name
      );
    end loop;
    grant execute on function
      public.create_or_reuse_underwriting_batch(jsonb) to service_role;
    grant execute on function
      public.save_underwriting_selections(jsonb) to service_role;
    grant execute on function
      public.create_selected_underwriting_candidates(jsonb) to service_role;
    grant execute on function
      public.claim_next_underwriting_candidate(text, integer) to service_role;
    grant execute on function
      public.save_underwriting_checkpoint(jsonb) to service_role;
    grant execute on function
      public.mark_candidate_underwriting_unavailable(jsonb) to service_role;
    grant execute on function
      public.mark_candidate_underwriting_failed(jsonb) to service_role;
    revoke all on function
      public.assert_underwriting_claim_edge(jsonb, jsonb, text)
      from service_role;
    grant execute on function
      public.finalize_candidate_underwriting(jsonb) to service_role;
    revoke all on function
      public.refresh_underwriting_batch_status(text) from service_role;
  end if;
end;
$$;

revoke create on schema public from vsee_underwriting_owner;

do $registry_owner_finish$
declare
  executor_role text := current_user;
  executor_is_superuser boolean;
begin
  select rolsuper into executor_is_superuser
  from pg_catalog.pg_roles where rolname = executor_role;
  if not executor_is_superuser then
    execute pg_catalog.format(
      'revoke vsee_registry_owner from %I granted by %I',
      executor_role,
      executor_role
    );
  end if;
  if exists (
    select 1 from pg_catalog.pg_auth_members as membership
    where (
      membership.roleid = 'vsee_registry_owner'::pg_catalog.regrole
      or membership.member = 'vsee_registry_owner'::pg_catalog.regrole
    ) and not (
      not executor_is_superuser
      and membership.roleid = 'vsee_registry_owner'::pg_catalog.regrole
      and membership.member = (
        select oid from pg_catalog.pg_roles where rolname = executor_role
      )
      and membership.grantor = 10
      and (select rolsuper from pg_catalog.pg_roles where oid = membership.grantor)
      and membership.admin_option
      and not membership.inherit_option and not membership.set_option
    )
  ) then
    raise exception 'vsee_registry_owner did not return to its attested state';
  end if;
end;
$registry_owner_finish$;

do $underwriting_owner_finish$
declare
  executor_role text := current_user;
  executor_is_superuser boolean;
begin
  select rolsuper into executor_is_superuser
  from pg_catalog.pg_roles where rolname = executor_role;
  if not executor_is_superuser then
    execute pg_catalog.format(
      'revoke vsee_underwriting_owner from %I granted by %I',
      executor_role,
      executor_role
    );
  end if;
  if exists (
    select 1 from pg_catalog.pg_auth_members as membership
    where (
      membership.roleid = 'vsee_underwriting_owner'::pg_catalog.regrole
      or membership.member = 'vsee_underwriting_owner'::pg_catalog.regrole
    ) and not (
      not executor_is_superuser
      and membership.roleid =
        'vsee_underwriting_owner'::pg_catalog.regrole
      and membership.member = (
        select oid from pg_catalog.pg_roles where rolname = executor_role
      )
      and membership.grantor = 10
      and (select rolsuper from pg_catalog.pg_roles where oid = membership.grantor)
      and membership.admin_option
      and not membership.inherit_option and not membership.set_option
    )
  ) then
    raise exception
      'vsee_underwriting_owner did not return to its attested state';
  end if;
end;
$underwriting_owner_finish$;

commit;

notify pgrst, 'reload schema';
