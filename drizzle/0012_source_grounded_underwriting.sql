begin;

alter table public.candidate_runs
  add column if not exists artifact_source_candidate_run_id text;

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
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  primary key (workspace_id, evidence_id),
  constraint source_evidence_items_workspace_deal_fkey
    foreign key (workspace_id, deal_id)
    references public.deals(workspace_id, id)
    on delete cascade,
  constraint source_evidence_items_workspace_revision_fkey
    foreign key (workspace_id, source_revision_id)
    references public.source_revisions(workspace_id, id),
  constraint source_evidence_items_payload_identity_check
    check (
      payload ->> 'id' = evidence_id
      and payload ->> 'workspaceId' = workspace_id
      and payload ->> 'dealId' = deal_id
      and payload ->> 'sourceRevisionId' = source_revision_id
    )
);

create index if not exists source_evidence_items_grounding_idx
on public.source_evidence_items(
  workspace_id, deal_id, source_revision_id, evidence_id
);

create table if not exists public.evidence_pack_builds (
  workspace_id text not null,
  input_fingerprint text not null check (
    input_fingerprint ~ '^sha256:[0-9a-f]{64}$'
  ),
  pack_id text not null,
  pack_payload jsonb not null check (jsonb_typeof(pack_payload) = 'object'),
  source_revision_snapshots jsonb not null check (
    jsonb_typeof(source_revision_snapshots) = 'array'
  ),
  created_at timestamptz not null default now(),
  primary key (workspace_id, input_fingerprint),
  constraint evidence_pack_builds_workspace_pack_unique
    unique (workspace_id, pack_id),
  constraint evidence_pack_builds_payload_identity_check
    check (
      pack_payload ->> 'workspaceId' = workspace_id
      and pack_payload ->> 'id' = pack_id
    )
);

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

  return public.finalize_candidate_underwriting(p_payload);
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

    prior := null;
    select payload into prior
    from public.source_evidence_items
    where source_evidence_items.workspace_id = v_workspace_id
      and source_evidence_items.evidence_id = v_evidence_id
    for update;
    if found then
      if prior <> item then
        raise exception
          'Source evidence % is immutable and already differs',
          v_evidence_id;
      end if;
    else
      insert into public.source_evidence_items (
        workspace_id, evidence_id, deal_id, source_revision_id, payload
      ) values (
        v_workspace_id, v_evidence_id, v_deal_id, v_revision_id, item
      );
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
  v_input_fingerprint text := btrim(p_payload ->> 'inputFingerprint');
  snapshots jsonb := p_payload -> 'sourceRevisionSnapshots';
  snapshot jsonb;
begin
  if coalesce(v_workspace_id, '') = ''
    or coalesce(v_pack_id, '') = ''
    or v_input_fingerprint !~ '^sha256:[0-9a-f]{64}$'
    or jsonb_typeof(p_payload -> 'pack') <> 'object'
    or jsonb_typeof(snapshots) <> 'array'
  then
    raise exception 'An immutable Evidence Pack build is required';
  end if;
  for snapshot in select value from jsonb_array_elements(snapshots)
  loop
    if snapshot ->> 'workspaceId' <> v_workspace_id
      or not exists (
        select 1
        from public.source_revisions
        where source_revisions.workspace_id = v_workspace_id
          and source_revisions.id = snapshot ->> 'id'
      )
    then
      raise exception 'Evidence Pack source snapshot does not resolve';
    end if;
  end loop;

  select * into target
  from public.evidence_pack_builds
  where evidence_pack_builds.workspace_id = v_workspace_id
    and (
      evidence_pack_builds.input_fingerprint =
        v_input_fingerprint
      or evidence_pack_builds.pack_id = v_pack_id
    )
  for update;
  if found then
    if target.input_fingerprint <> v_input_fingerprint
      or target.pack_id <> v_pack_id
      or target.pack_payload <> p_payload -> 'pack'
      or target.source_revision_snapshots <> snapshots
    then
      raise exception 'Evidence Pack build is immutable and already differs';
    end if;
    return to_jsonb(target);
  end if;

  insert into public.evidence_pack_builds (
    workspace_id, input_fingerprint, pack_id, pack_payload,
    source_revision_snapshots
  ) values (
    v_workspace_id, v_input_fingerprint, v_pack_id,
    p_payload -> 'pack', snapshots
  )
  returning * into target;
  return to_jsonb(target);
end;
$$;

create table if not exists public.critical_evidence_profile_fields (
  critical_evidence_profile_id text not null
    references public.critical_evidence_profiles(id),
  field_id text not null,
  critical boolean not null,
  minimum_model_input boolean not null,
  accepted_assertion_statuses jsonb not null check (
    jsonb_typeof(accepted_assertion_statuses) = 'array'
  ),
  accepted_freshness jsonb not null check (
    jsonb_typeof(accepted_freshness) = 'array'
  ),
  created_at timestamptz not null default now(),
  primary key (critical_evidence_profile_id, field_id)
);

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
grant select on table public.source_revisions to vsee_underwriting_owner;
drop policy if exists source_revisions_underwriting_owner
  on public.source_revisions;
create policy source_revisions_underwriting_owner
  on public.source_revisions
  for select to vsee_underwriting_owner using (true);

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
alter function public.save_source_evidence_items(jsonb)
  owner to vsee_underwriting_owner;
alter function public.save_evidence_pack_build(jsonb)
  owner to vsee_underwriting_owner;

revoke all on function
  public.claim_underwriting_candidate(text, text, text, integer) from public;
revoke all on function
  public.finalize_or_reuse_candidate_underwriting(jsonb) from public;
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
