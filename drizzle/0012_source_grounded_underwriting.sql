begin;

alter table public.candidate_runs
  add column if not exists artifact_source_candidate_run_id text;

alter table public.candidate_checkpoints
  add column if not exists input_fingerprint text,
  add column if not exists output_fingerprint text,
  add column if not exists output_payload jsonb,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists cost_units integer not null default 0,
  add column if not exists token_units integer not null default 0,
  add column if not exists actual_token_units integer not null default 0,
  add column if not exists provider_attempts jsonb not null default '[]'::jsonb,
  add column if not exists reason_code text;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'candidate_checkpoints'
      and column_name = 'artifact_fingerprint'
  ) then
    execute
      'update public.candidate_checkpoints
       set input_fingerprint = artifact_fingerprint
       where input_fingerprint is null';
  end if;
end;
$$;

alter table public.candidate_checkpoints
  alter column input_fingerprint set not null,
  drop column if exists artifact_fingerprint;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where connamespace = 'public'::regnamespace
      and conname = 'candidate_runs_workspace_artifact_source_fkey'
  ) then
    alter table public.candidate_runs
      add constraint candidate_runs_workspace_artifact_source_fkey
      foreign key (workspace_id, artifact_source_candidate_run_id)
      references public.candidate_runs(workspace_id, id);
  end if;
  if not exists (
    select 1
    from pg_constraint
    where connamespace = 'public'::regnamespace
      and conname = 'candidate_checkpoints_usage_check'
  ) then
    alter table public.candidate_checkpoints
      add constraint candidate_checkpoints_usage_check
      check (
        attempt_count >= 0
        and cost_units >= 0
        and token_units >= 0
        and actual_token_units >= 0
      );
  end if;
  if not exists (
    select 1
    from pg_constraint
    where connamespace = 'public'::regnamespace
      and conname = 'candidate_checkpoints_provider_attempts_shape_check'
  ) then
    alter table public.candidate_checkpoints
      add constraint candidate_checkpoints_provider_attempts_shape_check
      check (jsonb_typeof(provider_attempts) = 'array');
  end if;
  if not exists (
    select 1
    from pg_constraint
    where connamespace = 'public'::regnamespace
      and conname = 'candidate_runs_artifact_alias_shape_check'
  ) then
    alter table public.candidate_runs
      add constraint candidate_runs_artifact_alias_shape_check
      check (
        artifact_source_candidate_run_id is null
        or (
          status = 'completed'
          and rerun_of_id = artifact_source_candidate_run_id
        )
      );
  end if;
end;
$$;

drop index if exists public.candidate_runs_completed_fingerprint_unique;
create unique index candidate_runs_completed_fingerprint_unique
on public.candidate_runs(workspace_id, candidate_analysis_fingerprint)
where status = 'completed'
  and artifact_source_candidate_run_id is null;

create table if not exists public.source_evidence_items (
  workspace_id text not null,
  evidence_id text not null,
  deal_id text not null,
  source_revision_id text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, evidence_id),
  constraint source_evidence_items_workspace_deal_fkey
    foreign key (workspace_id, deal_id)
    references public.deals(workspace_id, id)
    on delete cascade,
  constraint source_evidence_items_workspace_revision_fkey
    foreign key (workspace_id, source_revision_id)
    references public.source_revisions(workspace_id, id),
  constraint source_evidence_items_payload_shape_check
    check (jsonb_typeof(payload) = 'object'),
  constraint source_evidence_items_payload_identity_check
    check (
      coalesce(
        payload ->> 'id' = evidence_id
        and payload ->> 'workspaceId' = workspace_id
        and payload ->> 'dealId' = deal_id
        and payload ->> 'sourceRevisionId' = source_revision_id,
        false
      )
  )
);

alter table public.source_evidence_items
  drop constraint if exists source_evidence_items_payload_shape_check;
alter table public.source_evidence_items
  add constraint source_evidence_items_payload_shape_check
  check (jsonb_typeof(payload) = 'object');
alter table public.source_evidence_items
  drop constraint if exists source_evidence_items_payload_identity_check;
alter table public.source_evidence_items
  add constraint source_evidence_items_payload_identity_check
  check (
    coalesce(
      payload ->> 'id' = evidence_id
      and payload ->> 'workspaceId' = workspace_id
      and payload ->> 'dealId' = deal_id
      and payload ->> 'sourceRevisionId' = source_revision_id,
      false
    )
  );

create index if not exists source_evidence_items_grounding_idx
on public.source_evidence_items(
  workspace_id, deal_id, source_revision_id, evidence_id
);

create table if not exists public.evidence_pack_builds (
  workspace_id text not null,
  input_fingerprint text not null,
  pack_id text not null,
  pack_payload jsonb not null,
  source_revision_snapshots jsonb not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, input_fingerprint),
  constraint evidence_pack_builds_workspace_pack_unique
    unique (workspace_id, pack_id),
  constraint evidence_pack_builds_payload_shape_check
    check (jsonb_typeof(pack_payload) = 'object'),
  constraint evidence_pack_builds_snapshots_shape_check
    check (jsonb_typeof(source_revision_snapshots) = 'array'),
  constraint evidence_pack_builds_payload_identity_check
    check (
      coalesce(
        pack_payload ->> 'workspaceId' = workspace_id
        and pack_payload ->> 'id' = pack_id
        and btrim(coalesce(pack_payload ->> 'dealId', '')) <> '',
        false
      )
  )
);

alter table public.evidence_pack_builds
  drop constraint if exists evidence_pack_builds_fingerprint_check;
alter table public.evidence_pack_builds
  drop constraint if exists evidence_pack_builds_input_fingerprint_check;
alter table public.evidence_pack_builds
  add constraint evidence_pack_builds_input_fingerprint_check
  check (input_fingerprint ~ '^sha256:[0-9a-f]{64}$');
alter table public.evidence_pack_builds
  drop constraint if exists evidence_pack_builds_payload_shape_check;
alter table public.evidence_pack_builds
  add constraint evidence_pack_builds_payload_shape_check
  check (jsonb_typeof(pack_payload) = 'object');
alter table public.evidence_pack_builds
  drop constraint if exists evidence_pack_builds_snapshots_shape_check;
alter table public.evidence_pack_builds
  add constraint evidence_pack_builds_snapshots_shape_check
  check (jsonb_typeof(source_revision_snapshots) = 'array');
alter table public.evidence_pack_builds
  drop constraint if exists evidence_pack_builds_payload_identity_check;
alter table public.evidence_pack_builds
  add constraint evidence_pack_builds_payload_identity_check
  check (
    coalesce(
      pack_payload ->> 'workspaceId' = workspace_id
      and pack_payload ->> 'id' = pack_id
      and btrim(coalesce(pack_payload ->> 'dealId', '')) <> '',
      false
    )
  );

do $migration$
declare
  function_definition text := pg_get_functiondef(
    'public.finalize_candidate_underwriting(jsonb)'::regprocedure
  );
begin
  if position(
    'evidence_pack ->> ''dealId'' <> target.deal_id'
    in function_definition
  ) > 0 then
    function_definition := replace(
      function_definition,
      'evidence_pack ->> ''dealId'' <> target.deal_id',
      'nullif(btrim(evidence_pack ->> ''dealId''), '''') '
        || 'is distinct from target.deal_id'
    );
    execute function_definition;
  end if;
  if position(
    'evidence_pack ->> ''dealId'' <> target.deal_id'
    in pg_get_functiondef(
      'public.finalize_candidate_underwriting(jsonb)'::regprocedure
    )
  ) > 0 then
    raise exception 'Legacy finalizer Deal binding remains null-unsafe';
  end if;
end;
$migration$;

create or replace function public.claim_underwriting_candidate(
  p_workspace_id text,
  p_candidate_run_id text,
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
  if btrim(coalesce(p_workspace_id, '')) = ''
    or btrim(coalesce(p_candidate_run_id, '')) = ''
    or btrim(coalesce(p_worker_id, '')) = ''
    or p_lease_seconds is null
    or p_lease_seconds <= 0
  then
    raise exception
      'A workspace, candidate, worker, and positive lease are required';
  end if;

  select * into target
  from public.candidate_runs
  where workspace_id = btrim(p_workspace_id)
    and id = btrim(p_candidate_run_id)
    and (
      status = 'queued'
      or (
        status = 'running'
        and (lease_expires_at is null or lease_expires_at <= now())
      )
    )
  for update skip locked;
  if not found then return null; end if;

  target_token := gen_random_uuid()::text;
  update public.candidate_runs
  set status = 'running',
      worker_id = btrim(p_worker_id),
      lease_token = target_token,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds)
  where workspace_id = target.workspace_id
    and id = target.id
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

create or replace function public.finalize_or_reuse_candidate_underwriting(
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.candidate_runs%rowtype;
  reusable public.candidate_runs%rowtype;
  target_fingerprint text := btrim(
    p_payload ->> 'candidateAnalysisFingerprint'
  );
  build_input_fingerprint text := btrim(
    p_payload ->> 'evidencePackBuildInputFingerprint'
  );
  evidence_pack jsonb := p_payload -> 'evidencePack';
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
  if target_fingerprint !~ '^sha256:[0-9a-f]{64}$' then
    raise exception 'A canonical candidate fingerprint is required';
  end if;

  select source.* into reusable
  from public.candidate_runs as source
  where source.workspace_id = target.workspace_id
    and source.id = target.rerun_of_id
    and source.deal_id = target.deal_id
    and source.status = 'completed'
    and source.candidate_analysis_fingerprint = target_fingerprint
    and source.artifact_source_candidate_run_id is null
  for key share;

  if found then
    update public.candidate_runs
    set status = 'completed',
        candidate_analysis_fingerprint = target_fingerprint,
        artifact_source_candidate_run_id = reusable.id,
        finalized_at = now(),
        worker_id = null,
        lease_token = null,
        lease_expires_at = null
    where workspace_id = target.workspace_id
      and id = target.id
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
      'createdAt',
        public.canonical_utc_iso_milliseconds(target.created_at),
      'finalizedAt',
        public.canonical_utc_iso_milliseconds(target.finalized_at)
    );
  end if;

  if build_input_fingerprint !~ '^sha256:[0-9a-f]{64}$'
    or jsonb_typeof(evidence_pack) <> 'object'
    or btrim(coalesce(evidence_pack ->> 'id', '')) = ''
    or evidence_pack ->> 'workspaceId' <> target.workspace_id
    or nullif(btrim(evidence_pack ->> 'dealId'), '')
      is distinct from target.deal_id
  then
    raise exception
      'Non-reuse finalization requires an immutable Evidence Pack build';
  end if;
  perform 1
  from public.evidence_pack_builds as build
  where build.workspace_id = target.workspace_id
    and build.input_fingerprint = build_input_fingerprint
    and build.pack_id = evidence_pack ->> 'id'
    and build.pack_payload = evidence_pack
  for key share;
  if not found then
    raise exception
      'Non-reuse finalization requires the exact immutable Evidence Pack build';
  end if;

  return public.finalize_candidate_underwriting(p_payload);
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
  prior public.candidate_checkpoints%rowtype;
  checkpoint jsonb := p_payload -> 'checkpoint';
  v_input_fingerprint text := btrim(checkpoint ->> 'inputFingerprint');
  v_output_fingerprint text := nullif(
    btrim(checkpoint ->> 'outputFingerprint'),
    ''
  );
  v_output_payload jsonb := case
    when jsonb_typeof(checkpoint -> 'outputPayload') = 'null' then null
    else checkpoint -> 'outputPayload'
  end;
  v_provider_attempts jsonb := checkpoint -> 'providerAttempts';
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
  if coalesce(v_input_fingerprint, '') = ''
    or jsonb_typeof(v_provider_attempts) <> 'array'
    or coalesce((checkpoint ->> 'attemptCount')::integer, -1) < 0
    or coalesce((checkpoint ->> 'costUnits')::integer, -1) < 0
    or coalesce((checkpoint ->> 'tokenUnits')::integer, -1) < 0
    or coalesce((checkpoint ->> 'actualTokenUnits')::integer, -1) < 0
  then
    raise exception 'Candidate checkpoint execution state is invalid';
  end if;

  select * into prior
  from public.candidate_checkpoints
  where candidate_run_id = target.id
    and stage = btrim(checkpoint ->> 'stage')
  for update;
  if found and prior.status = 'completed' then
    if prior.input_fingerprint <> v_input_fingerprint
      or prior.output_fingerprint is distinct from v_output_fingerprint
      or prior.output_payload is distinct from v_output_payload
      or prior.attempt_count <> (checkpoint ->> 'attemptCount')::integer
      or prior.cost_units <> (checkpoint ->> 'costUnits')::integer
      or prior.token_units <> (checkpoint ->> 'tokenUnits')::integer
      or prior.actual_token_units
        <> (checkpoint ->> 'actualTokenUnits')::integer
      or prior.provider_attempts <> v_provider_attempts
      or prior.reason_code is distinct from checkpoint ->> 'reasonCode'
      or prior.public_reason is distinct from checkpoint ->> 'publicReason'
    then
      raise exception 'Completed candidate checkpoint is immutable';
    end if;
    return;
  end if;
  if found and prior.input_fingerprint <> v_input_fingerprint then
    raise exception 'Candidate checkpoint input fingerprint changed';
  end if;

  insert into public.candidate_checkpoints (
    candidate_run_id, workspace_id, stage, status,
    input_fingerprint, output_fingerprint, output_payload,
    attempt_count, cost_units, token_units, actual_token_units,
    provider_attempts, reason_code, public_reason, saved_at
  ) values (
    target.id,
    target.workspace_id,
    btrim(checkpoint ->> 'stage'),
    btrim(checkpoint ->> 'status'),
    v_input_fingerprint,
    v_output_fingerprint,
    v_output_payload,
    (checkpoint ->> 'attemptCount')::integer,
    (checkpoint ->> 'costUnits')::integer,
    (checkpoint ->> 'tokenUnits')::integer,
    (checkpoint ->> 'actualTokenUnits')::integer,
    v_provider_attempts,
    checkpoint ->> 'reasonCode',
    checkpoint ->> 'publicReason',
    (checkpoint ->> 'savedAt')::timestamptz
  )
  on conflict (candidate_run_id, stage) do update set
    status = excluded.status,
    output_fingerprint = excluded.output_fingerprint,
    output_payload = excluded.output_payload,
    attempt_count = excluded.attempt_count,
    cost_units = excluded.cost_units,
    token_units = excluded.token_units,
    actual_token_units = excluded.actual_token_units,
    provider_attempts = excluded.provider_attempts,
    reason_code = excluded.reason_code,
    public_reason = excluded.public_reason,
    saved_at = excluded.saved_at;
end;
$$;

create or replace function public.save_source_evidence_items(
  p_items jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  prior jsonb;
  v_workspace_id text;
  v_evidence_id text;
  v_deal_id text;
  v_revision_id text;
begin
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'Source evidence items must be an array';
  end if;
  for item in select value from jsonb_array_elements(p_items)
  loop
    v_workspace_id := btrim(item ->> 'workspaceId');
    v_evidence_id := btrim(item ->> 'id');
    v_deal_id := btrim(item ->> 'dealId');
    v_revision_id := btrim(item ->> 'sourceRevisionId');
    if coalesce(v_workspace_id, '') = ''
      or coalesce(v_evidence_id, '') = ''
      or coalesce(v_deal_id, '') = ''
      or coalesce(v_revision_id, '') = ''
    then
      raise exception 'Source evidence identity is required';
    end if;

    insert into public.source_evidence_items (
      workspace_id, evidence_id, deal_id, source_revision_id, payload
    ) values (
      v_workspace_id, v_evidence_id, v_deal_id, v_revision_id, item
    )
    on conflict (workspace_id, evidence_id) do nothing;

    prior := null;
    select payload into strict prior
    from public.source_evidence_items
    where source_evidence_items.workspace_id = v_workspace_id
      and source_evidence_items.evidence_id = v_evidence_id
    for key share;
    if prior <> item then
      raise exception
        'Source evidence % is immutable and already differs',
        v_evidence_id;
    end if;
  end loop;
end;
$$;

create or replace function public.save_evidence_pack_build(
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.evidence_pack_builds%rowtype;
  v_workspace_id text := btrim(p_payload -> 'pack' ->> 'workspaceId');
  v_pack_id text := btrim(p_payload -> 'pack' ->> 'id');
  v_deal_id text := btrim(p_payload -> 'pack' ->> 'dealId');
  v_input_fingerprint text := btrim(p_payload ->> 'inputFingerprint');
  snapshots jsonb := p_payload -> 'sourceRevisionSnapshots';
  pack_revision_ids jsonb := p_payload -> 'pack' -> 'sourceRevisionIds';
  snapshot jsonb;
  immutable_revision public.source_revisions%rowtype;
  immutable_snapshot jsonb;
  pack_revision_count integer;
  pack_revision_distinct_count integer;
  snapshot_count integer;
  snapshot_distinct_count integer;
begin
  if coalesce(v_workspace_id, '') = ''
    or coalesce(v_pack_id, '') = ''
    or coalesce(v_deal_id, '') = ''
    or v_input_fingerprint !~ '^sha256:[0-9a-f]{64}$'
    or jsonb_typeof(p_payload -> 'pack') <> 'object'
    or jsonb_typeof(snapshots) <> 'array'
    or jsonb_typeof(pack_revision_ids) <> 'array'
  then
    raise exception 'An immutable Evidence Pack build is required';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(pack_revision_ids) as item(value)
    where jsonb_typeof(item.value) <> 'string'
  ) then
    raise exception
      'Evidence Pack revision IDs and snapshots must be duplicate-free exact sets';
  end if;

  select count(*), count(distinct item.value)
  into pack_revision_count, pack_revision_distinct_count
  from jsonb_array_elements_text(pack_revision_ids) as item(value);
  select count(*), count(distinct item.value ->> 'id')
  into snapshot_count, snapshot_distinct_count
  from jsonb_array_elements(snapshots) as item(value);
  if pack_revision_count <> pack_revision_distinct_count
    or snapshot_count <> snapshot_distinct_count
    or pack_revision_count <> snapshot_count
    or exists (
      select 1
      from jsonb_array_elements_text(pack_revision_ids) as pack_id(value)
      where not exists (
        select 1
        from jsonb_array_elements(snapshots) as source_snapshot(value)
        where source_snapshot.value ->> 'id' = pack_id.value
      )
    )
  then
    raise exception
      'Evidence Pack revision IDs and snapshots must be duplicate-free exact sets';
  end if;

  for snapshot in select value from jsonb_array_elements(snapshots)
  loop
    select revision.* into immutable_revision
    from public.source_revisions as revision
    where revision.workspace_id = v_workspace_id
      and revision.id = snapshot ->> 'id'
    for key share;
    if not found then
      raise exception 'Evidence Pack source snapshot does not resolve';
    end if;
    immutable_snapshot := jsonb_build_object(
      'id', immutable_revision.id,
      'workspaceId', immutable_revision.workspace_id,
      'sourceId', immutable_revision.source_id,
      'revision', immutable_revision.revision,
      'contentHash', immutable_revision.content_hash,
      'objectKey', immutable_revision.object_key,
      'objectVersion', immutable_revision.object_version,
      'contentType', immutable_revision.content_type,
      'extractorId', immutable_revision.extractor_id,
      'extractorVersion', immutable_revision.extractor_version,
      'extractedAt',
        public.canonical_utc_iso_milliseconds(
          immutable_revision.extracted_at
        ),
      'supersedesRevisionId',
        immutable_revision.supersedes_revision_id,
      'createdAt',
        public.canonical_utc_iso_milliseconds(
          immutable_revision.created_at
        )
    );
    if immutable_snapshot <> snapshot then
      raise exception
        'Evidence Pack source snapshot differs from its immutable revision';
    end if;
  end loop;

  insert into public.evidence_pack_builds (
    workspace_id, input_fingerprint, pack_id, pack_payload,
    source_revision_snapshots
  ) values (
    v_workspace_id, v_input_fingerprint, v_pack_id,
    p_payload -> 'pack', snapshots
  )
  on conflict do nothing;

  select * into strict target
  from public.evidence_pack_builds
  where evidence_pack_builds.workspace_id = v_workspace_id
    and (
      evidence_pack_builds.input_fingerprint =
        v_input_fingerprint
      or evidence_pack_builds.pack_id = v_pack_id
    )
  for key share;
  if target.input_fingerprint <> v_input_fingerprint
    or target.pack_id <> v_pack_id
    or target.pack_payload <> p_payload -> 'pack'
    or target.source_revision_snapshots <> snapshots
  then
    raise exception 'Evidence Pack build is immutable and already differs';
  end if;
  return to_jsonb(target);
end;
$$;

create table if not exists public.critical_evidence_profile_fields (
  critical_evidence_profile_id text not null
    references public.critical_evidence_profiles(id),
  field_id text not null,
  critical boolean not null,
  minimum_model_input boolean not null,
  accepted_assertion_statuses jsonb not null,
  accepted_freshness jsonb not null,
  created_at timestamptz not null default now(),
  primary key (critical_evidence_profile_id, field_id)
);

alter table public.critical_evidence_profile_fields
  drop constraint if exists
    critical_evidence_profile_fields_accepted_assertion_statuses_check;
alter table public.critical_evidence_profile_fields
  drop constraint if exists
    critical_evidence_profile_fields_accepted_freshness_check;
alter table public.critical_evidence_profile_fields
  drop constraint if exists
    critical_evidence_profile_fields_assertion_statuses_shape_check;
alter table public.critical_evidence_profile_fields
  add constraint
    critical_evidence_profile_fields_assertion_statuses_shape_check
  check (
    case when jsonb_typeof(accepted_assertion_statuses) = 'array' then
      jsonb_array_length(accepted_assertion_statuses) > 0
      and not jsonb_path_exists(
        accepted_assertion_statuses,
        '$[*] ? (@.type() != "string" || @ like_regex "^\\s*$")'
      )
    else false end
  );
alter table public.critical_evidence_profile_fields
  drop constraint if exists
    critical_evidence_profile_fields_freshness_shape_check;
alter table public.critical_evidence_profile_fields
  add constraint
    critical_evidence_profile_fields_freshness_shape_check
  check (
    case when jsonb_typeof(accepted_freshness) = 'array' then
      jsonb_array_length(accepted_freshness) > 0
      and not jsonb_path_exists(
        accepted_freshness,
        '$[*] ? (@.type() != "string" || @ like_regex "^\\s*$")'
      )
    else false end
  );

drop trigger if exists critical_evidence_profile_fields_immutable
  on public.critical_evidence_profile_fields;
create trigger critical_evidence_profile_fields_immutable
before update or delete on public.critical_evidence_profile_fields
for each row execute function
  public.reject_immutable_underwriting_reference();

insert into public.critical_evidence_profile_fields (
  critical_evidence_profile_id,
  field_id,
  critical,
  minimum_model_input,
  accepted_assertion_statuses,
  accepted_freshness
)
select
  profile.id,
  field.field_id,
  true,
  field.minimum_model_input,
  jsonb_build_array('reported', 'corroborated', 'verified'),
  jsonb_build_array('current')
from public.critical_evidence_profiles as profile
cross join (
  values
    ('company_identity', true),
    ('reported_valuation', true),
    ('reported_valuation_basis', true),
    ('arr', false),
    ('revenue', false),
    ('customer_evidence', false),
    ('cash', false),
    ('burn', false),
    ('runway', false)
) as field(field_id, minimum_model_input)
where profile.publication_status = 'published'
  and profile.id like 'critical_evidence_%'
on conflict (critical_evidence_profile_id, field_id) do nothing;

alter table public.source_evidence_items enable row level security;
alter table public.evidence_pack_builds enable row level security;
alter table public.critical_evidence_profile_fields
  enable row level security;
revoke all privileges on table public.source_evidence_items from public;
revoke all privileges on table public.evidence_pack_builds from public;
revoke all privileges on table public.critical_evidence_profile_fields
  from public;
grant select, insert, update, delete on table public.source_evidence_items
  to vsee_underwriting_owner;
grant select, insert, update, delete on table public.evidence_pack_builds
  to vsee_underwriting_owner;
grant select on table public.critical_evidence_profile_fields
  to vsee_underwriting_owner;
-- PostgreSQL row-locking SELECTs require UPDATE privilege; the append-only
-- trigger still rejects every actual source revision mutation.
grant select, update on table public.source_revisions
  to vsee_underwriting_owner;
drop policy if exists source_revisions_underwriting_owner
  on public.source_revisions;
create policy source_revisions_underwriting_owner
  on public.source_revisions
  for select to vsee_underwriting_owner using (true);
drop policy if exists source_revisions_underwriting_lock
  on public.source_revisions;
create policy source_revisions_underwriting_lock
  on public.source_revisions
  for update to vsee_underwriting_owner
  using (true)
  with check (false);

drop policy if exists source_evidence_items_underwriting_owner
  on public.source_evidence_items;
create policy source_evidence_items_underwriting_owner
  on public.source_evidence_items
  for all to vsee_underwriting_owner using (true) with check (true);
drop policy if exists evidence_pack_builds_underwriting_owner
  on public.evidence_pack_builds;
create policy evidence_pack_builds_underwriting_owner
  on public.evidence_pack_builds
  for all to vsee_underwriting_owner using (true) with check (true);
drop policy if exists critical_evidence_profile_fields_underwriting_owner
  on public.critical_evidence_profile_fields;
create policy critical_evidence_profile_fields_underwriting_owner
  on public.critical_evidence_profile_fields
  for select to vsee_underwriting_owner using (true);

alter function public.claim_underwriting_candidate(text, text, text, integer)
  owner to vsee_underwriting_owner;
alter function public.finalize_or_reuse_candidate_underwriting(jsonb)
  owner to vsee_underwriting_owner;
alter function public.finalize_candidate_underwriting(jsonb)
  owner to vsee_underwriting_owner;
alter function public.save_source_evidence_items(jsonb)
  owner to vsee_underwriting_owner;
alter function public.save_evidence_pack_build(jsonb)
  owner to vsee_underwriting_owner;

revoke all on function
  public.claim_underwriting_candidate(text, text, text, integer) from public;
revoke all on function
  public.finalize_or_reuse_candidate_underwriting(jsonb) from public;
revoke all on function public.finalize_candidate_underwriting(jsonb)
  from public;
revoke all on function public.save_source_evidence_items(jsonb) from public;
revoke all on function public.save_evidence_pack_build(jsonb) from public;

do $$
declare
  restricted_role text;
begin
  for restricted_role in
    select rolname from pg_roles
    where rolname in ('anon', 'authenticated')
  loop
    execute format(
      'revoke all privileges on table public.source_evidence_items from %I',
      restricted_role
    );
    execute format(
      'revoke all privileges on table public.evidence_pack_builds from %I',
      restricted_role
    );
    execute format(
      'revoke all privileges on table public.critical_evidence_profile_fields from %I',
      restricted_role
    );
    execute format(
      'revoke all on function public.claim_underwriting_candidate(text, text, text, integer) from %I',
      restricted_role
    );
    execute format(
      'revoke all on function public.finalize_or_reuse_candidate_underwriting(jsonb) from %I',
      restricted_role
    );
    execute format(
      'revoke all on function public.finalize_candidate_underwriting(jsonb) from %I',
      restricted_role
    );
    execute format(
      'revoke all on function public.save_source_evidence_items(jsonb) from %I',
      restricted_role
    );
    execute format(
      'revoke all on function public.save_evidence_pack_build(jsonb) from %I',
      restricted_role
    );
  end loop;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select on table public.source_evidence_items to service_role;
    grant select on table public.evidence_pack_builds to service_role;
    grant select on table public.critical_evidence_profile_fields
      to service_role;
    grant execute on function
      public.claim_underwriting_candidate(text, text, text, integer)
      to service_role;
    grant execute on function
      public.finalize_or_reuse_candidate_underwriting(jsonb)
      to service_role;
    revoke all on function public.finalize_candidate_underwriting(jsonb)
      from service_role;
    grant execute on function
      public.save_source_evidence_items(jsonb)
      to service_role;
    grant execute on function
      public.save_evidence_pack_build(jsonb)
      to service_role;
  end if;
end;
$$;

commit;

notify pgrst, 'reload schema';
