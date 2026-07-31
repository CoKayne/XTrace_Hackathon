begin;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'vsee_registry_owner'
  ) then
    create role vsee_registry_owner nologin noinherit nobypassrls;
  end if;
end;
$$;
alter role vsee_registry_owner
  nosuperuser nocreatedb nocreaterole noreplication
  nologin noinherit nobypassrls;

do $$
declare
  membership record;
begin
  for membership in
    select granted.rolname as granted_role, member.rolname as member_role
    from pg_catalog.pg_auth_members as link
    join pg_catalog.pg_roles as granted on granted.oid = link.roleid
    join pg_catalog.pg_roles as member on member.oid = link.member
    where granted.rolname = 'vsee_registry_owner'
      or member.rolname = 'vsee_registry_owner'
  loop
    execute pg_catalog.format(
      'revoke %I from %I',
      membership.granted_role,
      membership.member_role
    );
  end loop;

  if exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = 'vsee_registry_owner'
      and (
        rolsuper or rolinherit or rolcreaterole or rolcreatedb
        or rolcanlogin or rolreplication or rolbypassrls
      )
  ) or exists (
    select 1
    from pg_catalog.pg_auth_members
    where roleid = 'vsee_registry_owner'::regrole
      or member = 'vsee_registry_owner'::regrole
  ) then
    raise exception
      'vsee_registry_owner could not be normalized to an isolated owner role';
  end if;
end;
$$;

alter table public.deals
  add column if not exists status text,
  add column if not exists analysis_eligible_at timestamptz,
  add column if not exists active_source_revision_fingerprint text;

update public.deals as deal
set status = (
  select interaction.status
  from public.deal_interactions as interaction
  where interaction.workspace_id = deal.workspace_id
    and interaction.deal_id = deal.id
  order by interaction.occurred_at desc, interaction.created_at desc,
    interaction.id desc
  limit 1
)
where deal.status is null
  and exists (
    select 1
    from public.deal_interactions as interaction
    where interaction.workspace_id = deal.workspace_id
      and interaction.deal_id = deal.id
  );

update public.deals
set status = 'screening'
where status is null;

alter table public.deals
  alter column status set default 'screening',
  alter column status set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where connamespace = 'public'::regnamespace
      and conname = 'deals_status_check'
  ) then
    alter table public.deals
      add constraint deals_status_check
      check (
        status in (
          'screening', 'watchlist', 'evaluating', 'passed', 'invested'
        )
      );
  end if;
end;
$$;

create table if not exists public.source_revisions (
  id text not null,
  workspace_id text not null
    references public.workspaces(id) on delete cascade,
  source_id text not null,
  revision integer not null check (revision > 0),
  content_hash text not null check (btrim(content_hash) <> ''),
  object_key text not null check (btrim(object_key) <> ''),
  object_version text not null check (btrim(object_version) <> ''),
  content_type text not null check (btrim(content_type) <> ''),
  extractor_id text not null check (btrim(extractor_id) <> ''),
  extractor_version text not null check (btrim(extractor_version) <> ''),
  extracted_at timestamptz not null,
  supersedes_revision_id text,
  created_at timestamptz not null default now(),
  primary key (workspace_id, id),
  constraint source_revisions_workspace_source_revision_unique
    unique (workspace_id, source_id, revision),
  constraint source_revisions_workspace_source_id_unique
    unique (workspace_id, source_id, id),
  constraint source_revisions_initial_link_check
    check (
      (revision = 1 and supersedes_revision_id is null)
      or (revision > 1 and supersedes_revision_id is not null)
    ),
  constraint source_revisions_exact_supersedes_fkey
    foreign key (workspace_id, source_id, supersedes_revision_id)
    references public.source_revisions (workspace_id, source_id, id)
);

create index if not exists source_revisions_workspace_source_created
  on public.source_revisions (workspace_id, source_id, revision);

create table if not exists public.source_revision_annotations (
  id uuid not null default gen_random_uuid(),
  workspace_id text not null
    references public.workspaces(id) on delete cascade,
  revision_id text not null,
  kind text not null check (
    kind in ('retracted', 'identity_corrected', 'superseded')
  ),
  reason text not null check (btrim(reason) <> ''),
  superseded_by_run_id uuid,
  created_at timestamptz not null default now(),
  primary key (workspace_id, id),
  constraint source_revision_annotations_workspace_revision_fkey
    foreign key (workspace_id, revision_id)
    references public.source_revisions (workspace_id, id)
    on delete cascade,
  constraint source_revision_annotations_workspace_run_fkey
    foreign key (workspace_id, superseded_by_run_id)
    references public.scan_runs (workspace_id, id)
);

create table if not exists public.deal_source_assignments (
  id text not null,
  request_id text not null check (btrim(request_id) <> ''),
  request_fingerprint text check (
    request_fingerprint ~ '^sha256:[0-9a-f]{64}$'
  ),
  workspace_id text not null
    references public.workspaces(id) on delete cascade,
  deal_id text not null,
  source_id text not null,
  source_revision_id text not null,
  assigned_by_user_id text not null check (btrim(assigned_by_user_id) <> ''),
  reason text not null check (btrim(reason) <> ''),
  created_at timestamptz not null default now(),
  superseded_at timestamptz,
  primary key (workspace_id, id),
  constraint deal_source_assignments_workspace_request_unique
    unique (workspace_id, request_id),
  constraint deal_source_assignments_workspace_deal_fkey
    foreign key (workspace_id, deal_id)
    references public.deals (workspace_id, id)
    on delete cascade,
  constraint deal_source_assignments_exact_revision_fkey
    foreign key (workspace_id, source_id, source_revision_id)
    references public.source_revisions (workspace_id, source_id, id),
  constraint deal_source_assignments_supersession_time_check
    check (superseded_at is null or superseded_at >= created_at)
);

create unique index if not exists deal_source_assignments_one_active_source
  on public.deal_source_assignments (workspace_id, deal_id, source_id)
  where superseded_at is null;

create index if not exists deal_source_assignments_workspace_deal_created
  on public.deal_source_assignments (
    workspace_id, deal_id, created_at, source_revision_id
  );

alter table public.deal_source_assignments
  add column if not exists request_fingerprint text;

do $migration$
declare
  digest_schema text;
begin
  select namespace.nspname
  into digest_schema
  from pg_catalog.pg_extension as extension_record
  join pg_catalog.pg_depend as dependency
    on dependency.refclassid = 'pg_catalog.pg_extension'::regclass
    and dependency.refobjid = extension_record.oid
    and dependency.classid = 'pg_catalog.pg_proc'::regclass
    and dependency.deptype = 'e'
  join pg_catalog.pg_proc as procedure_record
    on procedure_record.oid = dependency.objid
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = procedure_record.pronamespace
  where extension_record.extname = 'pgcrypto'
    and procedure_record.proname = 'digest'
    and procedure_record.proargtypes = '17 25'::oidvector;

  if digest_schema is null then
    raise exception
      'pgcrypto digest(bytea, text) is required for source fingerprints';
  end if;

  execute pg_catalog.format(
    $function$
create or replace function public.sha256_length_framed(
  values_to_frame text[]
)
returns text
language sql
immutable
strict
security invoker
set search_path = ''
as $body$
  select 'sha256:' || pg_catalog.encode(
    %I.digest(
      pg_catalog.convert_to(
        pg_catalog.string_agg(
          pg_catalog.octet_length(value)::text || ':' || value,
          '' order by ordinal
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
  from pg_catalog.unnest(values_to_frame)
    with ordinality as framed(value, ordinal)
$body$;
    $function$,
    digest_schema
  );
end;
$migration$;

create or replace function public.canonical_utc_iso_milliseconds(
  p_value timestamptz
)
returns text
language sql
immutable
strict
parallel safe
security invoker
set search_path = ''
as $$
  select pg_catalog.to_char(
    p_value at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  )
$$;

create or replace function public.source_revision_set_fingerprint(
  revision_ids text[]
)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select public.sha256_length_framed(
    pg_catalog.array_prepend(
      'source-revisions-v2',
      coalesce(
        (
          select pg_catalog.array_agg(id order by id collate "C")
          from (
            select distinct id
            from pg_catalog.unnest(revision_ids) as ids(id)
          ) as unique_ids
        ),
        array[]::text[]
      )
    )
  )
$$;

create or replace function public.get_analysis_eligible_snapshot(
  p_workspace_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_workspace_id text := btrim(p_workspace_id);
  eligible_count integer;
  captured_count integer := 0;
  deal_ids text[] := array[]::text[];
  frames text[] := array['eligible-deals-v2'];
  captured record;
begin
  if coalesce(target_workspace_id, '') = '' then
    raise exception 'A workspace is required';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(
      jsonb_build_array(
        'analysis-eligible-snapshot', target_workspace_id
      )::text,
      0
    )
  );
  select count(*)::integer
  into eligible_count
  from public.deals as deal
  where deal.workspace_id = target_workspace_id
    and deal.analysis_eligible_at is not null;

  for captured in
    select
      deal.id,
      deal.status,
      public.source_revision_set_fingerprint(
        array_agg(
          assignment.source_revision_id
          order by assignment.source_revision_id collate "C"
        )
      ) as revision_fingerprint
    from public.deals as deal
    join public.deal_source_assignments as assignment
      on assignment.workspace_id = deal.workspace_id
      and assignment.deal_id = deal.id
      and assignment.superseded_at is null
    where deal.workspace_id = target_workspace_id
      and deal.analysis_eligible_at is not null
    group by deal.id, deal.status
    order by deal.id collate "C"
  loop
    captured_count := captured_count + 1;
    deal_ids := array_append(deal_ids, captured.id);
    frames := array_append(frames, captured.id);
    frames := array_append(frames, captured.status);
    frames := array_append(frames, captured.revision_fingerprint);
  end loop;

  if captured_count <> eligible_count then
    raise exception
      'Every analysis-eligible Deal must have an active source assignment';
  end if;
  return jsonb_build_object(
    'count', captured_count,
    'dealIds', to_jsonb(deal_ids),
    'fingerprint', public.sha256_length_framed(frames)
  );
end;
$$;

alter table public.source_evidence
  add column if not exists source_revision_id text;
alter table public.deal_interactions
  add column if not exists source_revision_id text;
alter table public.intelligence_reports
  add column if not exists eligible_snapshot_count integer,
  add column if not exists eligible_snapshot_fingerprint text;
alter table public.intelligence_reports
  add constraint intelligence_reports_eligible_snapshot_check
  check (
    (
      eligible_snapshot_count is null
      and eligible_snapshot_fingerprint is null
    )
    or (
      eligible_snapshot_count >= 0
      and btrim(eligible_snapshot_fingerprint) <> ''
    )
  );

create or replace function public.validate_source_revision_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  previous_revision integer;
begin
  if new.revision = 1 then
    if exists (
      select 1
      from public.source_revisions as existing
      where existing.workspace_id = new.workspace_id
        and existing.source_id = new.source_id
    ) then
      raise exception
        'Source revision 1 already exists for this workspace source';
    end if;
    return new;
  end if;

  select existing.revision
  into previous_revision
  from public.source_revisions as existing
  where existing.workspace_id = new.workspace_id
    and existing.source_id = new.source_id
    and existing.id = new.supersedes_revision_id;

  if previous_revision is null
    or previous_revision <> new.revision - 1
  then
    raise exception
      'A source revision must supersede the exact previous revision number';
  end if;
  return new;
end;
$$;

drop trigger if exists source_revisions_validate_insert
  on public.source_revisions;
create trigger source_revisions_validate_insert
before insert on public.source_revisions
for each row execute function public.validate_source_revision_insert();

create or replace function public.reject_immutable_source_registry_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception '% rows are append-only', tg_table_name;
end;
$$;

drop trigger if exists source_revisions_immutable
  on public.source_revisions;
create trigger source_revisions_immutable
before update or delete on public.source_revisions
for each row execute function
  public.reject_immutable_source_registry_mutation();

drop trigger if exists source_revision_annotations_immutable
  on public.source_revision_annotations;
create trigger source_revision_annotations_immutable
before update or delete on public.source_revision_annotations
for each row execute function
  public.reject_immutable_source_registry_mutation();

create or replace function public.create_initial_source_revision(
  p_revision jsonb
)
returns setof public.source_revisions
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_workspace_id text := btrim(p_revision ->> 'workspaceId');
  target_source_id text := btrim(p_revision ->> 'sourceId');
  target_revision_id text := btrim(p_revision ->> 'id');
  existing public.source_revisions%rowtype;
begin
  if jsonb_typeof(p_revision) <> 'object' then
    raise exception 'p_revision must be a JSON object';
  end if;
  if coalesce(target_workspace_id, '') = ''
    or coalesce(target_source_id, '') = ''
    or coalesce(target_revision_id, '') = ''
  then
    raise exception 'workspaceId, sourceId, and id are required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      jsonb_build_array(target_workspace_id, target_source_id)::text,
      0
    )
  );

  select revision.*
  into existing
  from public.source_revisions as revision
  where revision.workspace_id = target_workspace_id
    and revision.source_id = target_source_id
    and revision.revision = 1;

  if found then
    if existing.id <> target_revision_id
      or existing.content_hash <> btrim(p_revision ->> 'contentHash')
      or existing.object_key <> btrim(p_revision ->> 'objectKey')
      or existing.object_version <> btrim(p_revision ->> 'objectVersion')
      or existing.content_type <> btrim(p_revision ->> 'contentType')
      or existing.extractor_id <> btrim(p_revision ->> 'extractorId')
      or existing.extractor_version
        <> btrim(p_revision ->> 'extractorVersion')
      or existing.extracted_at
        <> (p_revision ->> 'extractedAt')::timestamptz
      or existing.created_at <> (p_revision ->> 'createdAt')::timestamptz
    then
      raise exception
        'Source revision 1 is immutable and contains different data';
    end if;
    return query
      select revision.*
      from public.source_revisions as revision
      where revision.workspace_id = target_workspace_id
        and revision.id = target_revision_id;
    return;
  end if;

  insert into public.source_revisions (
    id, workspace_id, source_id, revision, content_hash, object_key,
    object_version, content_type, extractor_id, extractor_version,
    extracted_at, supersedes_revision_id, created_at
  ) values (
    target_revision_id,
    target_workspace_id,
    target_source_id,
    1,
    btrim(p_revision ->> 'contentHash'),
    btrim(p_revision ->> 'objectKey'),
    btrim(p_revision ->> 'objectVersion'),
    btrim(p_revision ->> 'contentType'),
    btrim(p_revision ->> 'extractorId'),
    btrim(p_revision ->> 'extractorVersion'),
    (p_revision ->> 'extractedAt')::timestamptz,
    null,
    (p_revision ->> 'createdAt')::timestamptz
  );

  return query
    select revision.*
    from public.source_revisions as revision
    where revision.workspace_id = target_workspace_id
      and revision.id = target_revision_id;
end;
$$;

create or replace function public.append_source_revision(
  p_revision jsonb
)
returns setof public.source_revisions
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_workspace_id text := btrim(p_revision ->> 'workspaceId');
  target_source_id text := btrim(p_revision ->> 'sourceId');
  target_revision_id text := btrim(p_revision ->> 'id');
  target_supersedes_id text := btrim(p_revision ->> 'supersedesRevisionId');
  current_revision public.source_revisions%rowtype;
  existing_target public.source_revisions%rowtype;
begin
  if jsonb_typeof(p_revision) <> 'object' then
    raise exception 'p_revision must be a JSON object';
  end if;
  if coalesce(target_workspace_id, '') = ''
    or coalesce(target_source_id, '') = ''
    or coalesce(target_revision_id, '') = ''
    or coalesce(target_supersedes_id, '') = ''
  then
    raise exception
      'workspaceId, sourceId, id, and supersedesRevisionId are required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      jsonb_build_array(target_workspace_id, target_source_id)::text,
      0
    )
  );

  select revision.*
  into existing_target
  from public.source_revisions as revision
  where revision.workspace_id = target_workspace_id
    and revision.id = target_revision_id;
  if found then
    if existing_target.source_id <> target_source_id
      or existing_target.content_hash <> btrim(p_revision ->> 'contentHash')
      or existing_target.object_key <> btrim(p_revision ->> 'objectKey')
      or existing_target.object_version <> btrim(p_revision ->> 'objectVersion')
      or existing_target.content_type <> btrim(p_revision ->> 'contentType')
      or existing_target.extractor_id <> btrim(p_revision ->> 'extractorId')
      or existing_target.extractor_version
        <> btrim(p_revision ->> 'extractorVersion')
      or existing_target.extracted_at
        <> (p_revision ->> 'extractedAt')::timestamptz
      or existing_target.supersedes_revision_id <> target_supersedes_id
      or existing_target.created_at
        <> (p_revision ->> 'createdAt')::timestamptz
    then
      raise exception
        'Source revision is immutable and contains different data';
    end if;
    return query
      select revision.*
      from public.source_revisions as revision
      where revision.workspace_id = target_workspace_id
        and revision.id = target_revision_id;
    return;
  end if;

  select revision.*
  into current_revision
  from public.source_revisions as revision
  where revision.workspace_id = target_workspace_id
    and revision.source_id = target_source_id
  order by revision.revision desc
  limit 1;

  if not found then
    raise exception 'An initial source revision is required';
  end if;
  if current_revision.id <> target_supersedes_id then
    raise exception
      'A source append must supersede the exact current previous revision';
  end if;

  insert into public.source_revisions (
    id, workspace_id, source_id, revision, content_hash, object_key,
    object_version, content_type, extractor_id, extractor_version,
    extracted_at, supersedes_revision_id, created_at
  ) values (
    target_revision_id,
    target_workspace_id,
    target_source_id,
    current_revision.revision + 1,
    btrim(p_revision ->> 'contentHash'),
    btrim(p_revision ->> 'objectKey'),
    btrim(p_revision ->> 'objectVersion'),
    btrim(p_revision ->> 'contentType'),
    btrim(p_revision ->> 'extractorId'),
    btrim(p_revision ->> 'extractorVersion'),
    (p_revision ->> 'extractedAt')::timestamptz,
    target_supersedes_id,
    (p_revision ->> 'createdAt')::timestamptz
  );

  return query
    select revision.*
    from public.source_revisions as revision
    where revision.workspace_id = target_workspace_id
      and revision.id = target_revision_id;
end;
$$;

create or replace function public.annotate_source_revision(
  p_annotation jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_workspace_id text := btrim(p_annotation ->> 'workspaceId');
  target_revision_id text := btrim(p_annotation ->> 'revisionId');
  target_kind text := btrim(p_annotation ->> 'kind');
  target_reason text := btrim(p_annotation ->> 'reason');
begin
  if coalesce(target_workspace_id, '') = ''
    or coalesce(target_revision_id, '') = ''
    or coalesce(target_reason, '') = ''
  then
    raise exception 'The complete source annotation is required';
  end if;
  if target_kind not in ('retracted', 'identity_corrected', 'superseded') then
    raise exception 'The source revision annotation kind is invalid';
  end if;
  if not exists (
    select 1 from public.source_revisions as revision
    where revision.workspace_id = target_workspace_id
      and revision.id = target_revision_id
  ) then
    raise exception 'The source revision does not exist in this workspace';
  end if;
  insert into public.source_revision_annotations (
    workspace_id, revision_id, kind, reason, superseded_by_run_id
  ) values (
    target_workspace_id, target_revision_id, target_kind, target_reason,
    nullif(p_annotation ->> 'supersededByRunId', '')::uuid
  );
end;
$$;

-- Upgrade already-seeded databases without assuming a fixed Deal count.
with owned_sources as (
  select evidence.workspace_id, evidence.document_id as source_id
  from public.source_evidence as evidence
  union
  select interaction.workspace_id, interaction.document_id
  from public.deal_interactions as interaction
  union
  select workspace.id, document.id
  from public.workspaces as workspace
  cross join public.source_documents as document
  where workspace.id = 'workspace_demo'
    and document.object_key like 'private/demo-corpus/%'
)
insert into public.source_revisions (
  id, workspace_id, source_id, revision, content_hash, object_key,
  object_version, content_type, extractor_id, extractor_version,
  extracted_at, supersedes_revision_id, created_at
)
select
  'source_revision_' || document.id || '_1',
  owned.workspace_id,
  document.id,
  1,
  document.checksum,
  document.object_key,
  document.checksum,
  'application/pdf',
  'preloaded-pdf',
  '1',
  document.created_at,
  null,
  document.created_at
from owned_sources as owned
join public.source_documents as document on document.id = owned.source_id
on conflict (workspace_id, source_id, revision) do nothing;

update public.source_evidence as evidence
set source_revision_id = revision.id
from public.source_revisions as revision
where evidence.source_revision_id is null
  and revision.workspace_id = evidence.workspace_id
  and revision.source_id = evidence.document_id
  and revision.revision = 1;

update public.deal_interactions as interaction
set source_revision_id = revision.id
from public.source_revisions as revision
where interaction.source_revision_id is null
  and revision.workspace_id = interaction.workspace_id
  and revision.source_id = interaction.document_id
  and revision.revision = 1;

alter table public.source_evidence
  add constraint source_evidence_exact_revision_fkey
  foreign key (workspace_id, document_id, source_revision_id)
  references public.source_revisions (workspace_id, source_id, id);
alter table public.deal_interactions
  add constraint deal_interactions_exact_revision_fkey
  foreign key (workspace_id, document_id, source_revision_id)
  references public.source_revisions (workspace_id, source_id, id);

with evidence_ownership as (
  select evidence.workspace_id, evidence.deal_id,
    evidence.document_id as source_id
  from public.source_evidence as evidence
  union
  select interaction.workspace_id, interaction.deal_id,
    interaction.document_id
  from public.deal_interactions as interaction
)
insert into public.deal_source_assignments (
  id, request_id, request_fingerprint, workspace_id, deal_id, source_id,
  source_revision_id,
  assigned_by_user_id, reason, created_at, superseded_at
)
select
  'backfill:' || public.sha256_length_framed(array[
    ownership.workspace_id, ownership.deal_id, ownership.source_id
  ]),
  'backfill:' || public.sha256_length_framed(array[
    ownership.deal_id, ownership.source_id
  ]),
  public.sha256_length_framed(array[
    'confirmation-request-v1', ownership.workspace_id, ownership.deal_id,
    deal.company_id, deal.company_name, deal.status, revision.id,
    'migration:0009',
    'Backfilled from existing source-backed Deal evidence.',
    deal.created_at::text
  ]),
  ownership.workspace_id,
  ownership.deal_id,
  ownership.source_id,
  revision.id,
  'migration:0009',
  'Backfilled from existing source-backed Deal evidence.',
  deal.created_at,
  null
from evidence_ownership as ownership
join public.deals as deal
  on deal.workspace_id = ownership.workspace_id
  and deal.id = ownership.deal_id
join public.source_revisions as revision
  on revision.workspace_id = ownership.workspace_id
  and revision.source_id = ownership.source_id
  and revision.revision = 1
on conflict (workspace_id, request_id) do nothing;

update public.deal_source_assignments
set request_fingerprint = public.sha256_length_framed(array[
  'legacy-confirmation-request-v1', workspace_id, request_id, deal_id,
  source_id, source_revision_id, assigned_by_user_id, reason,
  public.canonical_utc_iso_milliseconds(created_at)
])
where request_fingerprint is null;

alter table public.deal_source_assignments
  alter column request_fingerprint set not null;

update public.deals as deal
set
  analysis_eligible_at = coalesce(
    deal.analysis_eligible_at,
    active.first_assignment_at
  ),
  active_source_revision_fingerprint =
    public.source_revision_set_fingerprint(active.revision_ids)
from (
  select assignment.workspace_id, assignment.deal_id,
    min(assignment.created_at) as first_assignment_at,
    array_agg(
      assignment.source_revision_id
      order by assignment.source_revision_id collate "C"
    ) as revision_ids
  from public.deal_source_assignments as assignment
  where assignment.superseded_at is null
  group by assignment.workspace_id, assignment.deal_id
) as active
where deal.workspace_id = active.workspace_id
  and deal.id = active.deal_id;

create or replace function public.source_assignment_result(
  target_deal public.deals,
  target_revision public.source_revisions,
  active_revision_ids text[],
  newly_eligible boolean
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'deal', jsonb_build_object(
      'id', target_deal.id,
      'workspaceId', target_deal.workspace_id,
      'companyId', target_deal.company_id,
      'companyName', target_deal.company_name,
      'status', target_deal.status,
      'analysisEligibleAt', target_deal.analysis_eligible_at,
      'activeSourceRevisionFingerprint',
        target_deal.active_source_revision_fingerprint,
      'activeSourceRevisionIds', to_jsonb(active_revision_ids)
    ),
    'sourceRevision', jsonb_build_object(
      'id', target_revision.id,
      'workspaceId', target_revision.workspace_id,
      'sourceId', target_revision.source_id,
      'revision', target_revision.revision,
      'contentHash', target_revision.content_hash,
      'objectKey', target_revision.object_key,
      'objectVersion', target_revision.object_version,
      'contentType', target_revision.content_type,
      'extractorId', target_revision.extractor_id,
      'extractorVersion', target_revision.extractor_version,
      'extractedAt', target_revision.extracted_at,
      'supersedesRevisionId', target_revision.supersedes_revision_id,
      'createdAt', target_revision.created_at
    ),
    'newlyEligible', newly_eligible
  );
$$;

create or replace function public.confirm_source_assignment(
  p_assignment jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_request_id text := btrim(p_assignment ->> 'requestId');
  target_workspace_id text := btrim(p_assignment ->> 'workspaceId');
  target_deal_id text := btrim(p_assignment ->> 'dealId');
  target_company_id text := btrim(p_assignment ->> 'companyId');
  target_company_name text := btrim(p_assignment ->> 'companyName');
  target_status text := btrim(p_assignment ->> 'status');
  target_revision_id text := btrim(p_assignment ->> 'sourceRevisionId');
  target_user_id text := btrim(p_assignment ->> 'assignedByUserId');
  target_reason text := btrim(p_assignment ->> 'reason');
  target_confirmed_at timestamptz :=
    (p_assignment ->> 'confirmedAt')::timestamptz;
  target_request_fingerprint text;
  source_revision public.source_revisions%rowtype;
  existing_request public.deal_source_assignments%rowtype;
  existing_company public.companies%rowtype;
  existing_deal public.deals%rowtype;
  was_eligible boolean;
  active_revision_ids text[];
  active_fingerprint text;
begin
  if jsonb_typeof(p_assignment) <> 'object' then
    raise exception 'p_assignment must be a JSON object';
  end if;
  if coalesce(target_request_id, '') = ''
    or coalesce(target_workspace_id, '') = ''
    or coalesce(target_deal_id, '') = ''
    or coalesce(target_company_id, '') = ''
    or coalesce(target_company_name, '') = ''
    or coalesce(target_revision_id, '') = ''
    or coalesce(target_user_id, '') = ''
    or coalesce(target_reason, '') = ''
  then
    raise exception 'The complete source assignment identity is required';
  end if;
  if target_status not in (
    'screening', 'watchlist', 'evaluating', 'passed', 'invested'
  ) then
    raise exception 'The Deal status is invalid';
  end if;
  target_request_fingerprint := public.sha256_length_framed(array[
    'confirmation-request-v1', target_workspace_id, target_deal_id,
    target_company_id, target_company_name, target_status,
    target_revision_id, target_user_id, target_reason,
    public.canonical_utc_iso_milliseconds(target_confirmed_at)
  ]);

  perform pg_advisory_xact_lock(
    hashtextextended(
      jsonb_build_array(
        'analysis-eligible-snapshot', target_workspace_id
      )::text,
      0
    )
  );
  perform pg_advisory_xact_lock(
    hashtextextended(
      jsonb_build_array(target_workspace_id, target_deal_id)::text,
      0
    )
  );
  perform pg_advisory_xact_lock(
    hashtextextended(
      jsonb_build_array(target_workspace_id, target_revision_id)::text,
      0
    )
  );

  select revision.*
  into source_revision
  from public.source_revisions as revision
  where revision.workspace_id = target_workspace_id
    and revision.id = target_revision_id;
  if not found then
    raise exception 'The source revision does not exist in this workspace';
  end if;

  select assignment.*
  into existing_request
  from public.deal_source_assignments as assignment
  where assignment.workspace_id = target_workspace_id
    and assignment.request_id = target_request_id;
  if found then
    if existing_request.request_fingerprint
      <> target_request_fingerprint then
      raise exception
        'The confirmation request was used for a different Deal or revision';
    end if;
    select deal.*
    into existing_deal
    from public.deals as deal
    where deal.workspace_id = target_workspace_id
      and deal.id = target_deal_id;
    select array_agg(
      assignment.source_revision_id
      order by assignment.source_revision_id
    )
    into active_revision_ids
    from public.deal_source_assignments as assignment
    where assignment.workspace_id = target_workspace_id
      and assignment.deal_id = target_deal_id
      and assignment.superseded_at is null;
    return public.source_assignment_result(
      existing_deal,
      source_revision,
      coalesce(active_revision_ids, array[]::text[]),
      false
    );
  end if;

  select company.*
  into existing_company
  from public.companies as company
  where company.workspace_id = target_workspace_id
    and company.id = target_company_id;
  if found and existing_company.name <> target_company_name then
    raise exception
      'The company id belongs to a different workspace company identity';
  end if;
  if not found then
    insert into public.companies (workspace_id, id, name)
    values (target_workspace_id, target_company_id, target_company_name);
  end if;

  select deal.*
  into existing_deal
  from public.deals as deal
  where deal.workspace_id = target_workspace_id
    and deal.id = target_deal_id;
  if found and (
    existing_deal.company_id <> target_company_id
    or existing_deal.company_name <> target_company_name
  ) then
    raise exception
      'The Deal belongs to a different company in this workspace';
  end if;
  was_eligible := found and existing_deal.analysis_eligible_at is not null;
  if not found then
    insert into public.deals (
      workspace_id, id, company_id, company_name, status
    ) values (
      target_workspace_id, target_deal_id, target_company_id,
      target_company_name, target_status
    );
  else
    update public.deals as deal
    set status = target_status
    where deal.workspace_id = target_workspace_id
      and deal.id = target_deal_id;
  end if;

  if not exists (
    select 1
    from public.deal_source_assignments as assignment
    where assignment.workspace_id = target_workspace_id
      and assignment.deal_id = target_deal_id
      and assignment.source_id = source_revision.source_id
      and assignment.source_revision_id = target_revision_id
      and assignment.superseded_at is null
  ) then
    update public.deal_source_assignments as assignment
    set superseded_at = target_confirmed_at
    where assignment.workspace_id = target_workspace_id
      and assignment.deal_id = target_deal_id
      and assignment.source_id = source_revision.source_id
      and assignment.superseded_at is null;

    insert into public.deal_source_assignments (
      id, request_id, request_fingerprint, workspace_id, deal_id, source_id,
      source_revision_id, assigned_by_user_id, reason, created_at
    ) values (
      'assignment:' || public.sha256_length_framed(array[
        target_workspace_id, target_request_id
      ]),
      target_request_id,
      target_request_fingerprint,
      target_workspace_id,
      target_deal_id,
      source_revision.source_id,
      target_revision_id,
      target_user_id,
      target_reason,
      target_confirmed_at
    );
  end if;

  select
    array_agg(
      assignment.source_revision_id
      order by assignment.source_revision_id collate "C"
    ),
    public.source_revision_set_fingerprint(
      array_agg(
        assignment.source_revision_id
        order by assignment.source_revision_id collate "C"
      )
    )
  into active_revision_ids, active_fingerprint
  from public.deal_source_assignments as assignment
  where assignment.workspace_id = target_workspace_id
    and assignment.deal_id = target_deal_id
    and assignment.superseded_at is null;

  update public.deals as deal
  set
    analysis_eligible_at = coalesce(
      deal.analysis_eligible_at,
      target_confirmed_at
    ),
    active_source_revision_fingerprint = active_fingerprint
  where deal.workspace_id = target_workspace_id
    and deal.id = target_deal_id
  returning deal.* into existing_deal;

  return public.source_assignment_result(
    existing_deal,
    source_revision,
    coalesce(active_revision_ids, array[]::text[]),
    not was_eligible
  );
end;
$$;

alter function public.save_intelligence_report(jsonb, jsonb)
  rename to save_intelligence_report_legacy_0009;

create or replace function public.save_intelligence_report(
  p_report jsonb,
  p_analyses jsonb
)
returns setof public.intelligence_reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_report_id text := btrim(p_report ->> 'id');
  target_workspace_id text := btrim(p_report ->> 'workspaceId');
  target_run_id uuid := (p_report ->> 'runId')::uuid;
  target_snapshot_count integer :=
    (p_report ->> 'eligibleSnapshotCount')::integer;
  target_snapshot_fingerprint text :=
    nullif(btrim(p_report ->> 'eligibleSnapshotFingerprint'), '');
  authoritative_snapshot jsonb;
  authoritative_deal_ids text[];
  submitted_deal_ids text[];
  existing_report public.intelligence_reports%rowtype;
begin
  if jsonb_typeof(p_report) <> 'object'
    or jsonb_typeof(p_analyses) <> 'array'
  then
    raise exception 'A report object and analyses array are required';
  end if;
  if coalesce(target_report_id, '') = ''
    or coalesce(target_workspace_id, '') = ''
  then
    raise exception 'The report identity is required';
  end if;
  if target_snapshot_fingerprint is null then
    if jsonb_array_length(p_analyses) <> 0 then
      raise exception
        'Legacy reports cannot save new company analyses without a snapshot';
    end if;
  elsif target_snapshot_count is null
    or target_snapshot_count < 0
    or target_snapshot_count <> jsonb_array_length(p_analyses)
    or target_snapshot_count
      <> coalesce((p_report ->> 'companyCount')::integer, -1)
  then
    raise exception
      'The eligible Deal snapshot must match analyses and company count';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      jsonb_build_array(target_workspace_id, target_report_id)::text,
      0
    )
  );
  if target_snapshot_fingerprint is not null then
    authoritative_snapshot :=
      public.get_analysis_eligible_snapshot(target_workspace_id);
    authoritative_deal_ids := array(
      select value
      from jsonb_array_elements_text(
        authoritative_snapshot -> 'dealIds'
      ) as ids(value)
      order by value collate "C"
    );
    submitted_deal_ids := array(
      select deal_id
      from (
        select distinct analysis ->> 'dealId' as deal_id
        from jsonb_array_elements(p_analyses) as analysis
      ) as submitted
      order by deal_id collate "C"
    );
    if target_snapshot_count
        <> (authoritative_snapshot ->> 'count')::integer
      or target_snapshot_fingerprint
        <> authoritative_snapshot ->> 'fingerprint'
      or submitted_deal_ids is distinct from authoritative_deal_ids
      or cardinality(submitted_deal_ids) <> jsonb_array_length(p_analyses)
    then
      raise exception
        'The submitted report does not match the authoritative eligible Deal snapshot';
    end if;
  end if;
  select report.*
  into existing_report
  from public.intelligence_reports as report
  where report.workspace_id = target_workspace_id
    and report.id = target_report_id;
  if found and (
    existing_report.run_id <> target_run_id
    or existing_report.eligible_snapshot_count
      is distinct from target_snapshot_count
    or existing_report.eligible_snapshot_fingerprint
      is distinct from target_snapshot_fingerprint
  ) then
    raise exception
      'A report cannot overwrite a different run or eligible Deal snapshot';
  end if;

  perform 1
  from public.save_intelligence_report_legacy_0009(
    p_report, p_analyses
  );

  update public.intelligence_reports as report
  set
    eligible_snapshot_count = target_snapshot_count,
    eligible_snapshot_fingerprint = target_snapshot_fingerprint
  where report.workspace_id = target_workspace_id
    and report.id = target_report_id;

  return query
  select report.*
  from public.intelligence_reports as report
  where report.workspace_id = target_workspace_id
    and report.id = target_report_id;
end;
$$;

create or replace function public.reset_intelligence_products(
  p_workspace_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_workspace_id text := btrim(p_workspace_id);
begin
  if coalesce(target_workspace_id, '') = '' then
    raise exception 'A workspace is required';
  end if;
  delete from public.company_analyses as analysis
  where analysis.workspace_id = target_workspace_id;
  delete from public.intelligence_reports as report
  where report.workspace_id = target_workspace_id;
end;
$$;

alter table public.source_revisions enable row level security;
alter table public.source_revision_annotations enable row level security;
alter table public.deal_source_assignments enable row level security;

grant usage on schema public to vsee_registry_owner;
grant select, insert on public.source_revisions to vsee_registry_owner;
grant select, insert on public.source_revision_annotations
  to vsee_registry_owner;
grant select, insert, update on public.deal_source_assignments
  to vsee_registry_owner;
grant select, insert on public.companies to vsee_registry_owner;
grant select, insert, update on public.deals to vsee_registry_owner;
grant select, insert, update on public.intelligence_reports
  to vsee_registry_owner;
grant select, insert, update, delete on public.company_analyses
  to vsee_registry_owner;
grant execute on function
  public.save_intelligence_report_legacy_0009(jsonb, jsonb)
  to vsee_registry_owner;

create policy source_revisions_registry_owner
  on public.source_revisions for all to vsee_registry_owner
  using (true) with check (true);
create policy source_annotations_registry_owner
  on public.source_revision_annotations for all to vsee_registry_owner
  using (true) with check (true);
create policy source_assignments_registry_owner
  on public.deal_source_assignments for all to vsee_registry_owner
  using (true) with check (true);
create policy companies_registry_owner
  on public.companies for all to vsee_registry_owner
  using (true) with check (true);
create policy deals_registry_owner
  on public.deals for all to vsee_registry_owner
  using (true) with check (true);
create policy intelligence_reports_registry_owner
  on public.intelligence_reports for all to vsee_registry_owner
  using (true) with check (true);
create policy company_analyses_registry_owner
  on public.company_analyses for all to vsee_registry_owner
  using (true) with check (true);

alter function public.create_initial_source_revision(jsonb)
  owner to vsee_registry_owner;
alter function public.append_source_revision(jsonb)
  owner to vsee_registry_owner;
alter function public.annotate_source_revision(jsonb)
  owner to vsee_registry_owner;
alter function public.confirm_source_assignment(jsonb)
  owner to vsee_registry_owner;
alter function public.save_intelligence_report(jsonb, jsonb)
  owner to vsee_registry_owner;
alter function public.reset_intelligence_products(text)
  owner to vsee_registry_owner;
alter function public.source_assignment_result(
  public.deals, public.source_revisions, text[], boolean
) owner to vsee_registry_owner;
alter function public.sha256_length_framed(text[])
  owner to vsee_registry_owner;
alter function public.canonical_utc_iso_milliseconds(timestamptz)
  owner to vsee_registry_owner;
alter function public.source_revision_set_fingerprint(text[])
  owner to vsee_registry_owner;
alter function public.get_analysis_eligible_snapshot(text)
  owner to vsee_registry_owner;

revoke all privileges on table public.source_revisions from public;
revoke all privileges on table public.source_revision_annotations from public;
revoke all privileges on table public.deal_source_assignments from public;
revoke all on function public.create_initial_source_revision(jsonb)
  from public;
revoke all on function public.append_source_revision(jsonb) from public;
revoke all on function public.annotate_source_revision(jsonb) from public;
revoke all on function public.confirm_source_assignment(jsonb) from public;
revoke all on function public.save_intelligence_report(jsonb, jsonb)
  from public;
revoke all on function public.reset_intelligence_products(text)
  from public;
revoke all on function public.get_analysis_eligible_snapshot(text)
  from public;
revoke all on function public.canonical_utc_iso_milliseconds(timestamptz)
  from public;
revoke all on function
  public.save_intelligence_report_legacy_0009(jsonb, jsonb)
  from public;
revoke all on function public.source_assignment_result(
  public.deals, public.source_revisions, text[], boolean
) from public;

do $$
declare
  restricted_role text;
begin
  for restricted_role in
    select rolname from pg_roles where rolname in ('anon', 'authenticated')
  loop
    execute format(
      'revoke all privileges on table public.source_revisions from %I',
      restricted_role
    );
    execute format(
      'revoke all privileges on table public.source_revision_annotations from %I',
      restricted_role
    );
    execute format(
      'revoke all privileges on table public.deal_source_assignments from %I',
      restricted_role
    );
    execute format(
      'revoke all on function public.create_initial_source_revision(jsonb) from %I',
      restricted_role
    );
    execute format(
      'revoke all on function public.append_source_revision(jsonb) from %I',
      restricted_role
    );
    execute format(
      'revoke all on function public.annotate_source_revision(jsonb) from %I',
      restricted_role
    );
    execute format(
      'revoke all on function public.confirm_source_assignment(jsonb) from %I',
      restricted_role
    );
    execute format(
      'revoke all on function public.reset_intelligence_products(text) from %I',
      restricted_role
    );
    execute format(
      'revoke all on function public.get_analysis_eligible_snapshot(text) from %I',
      restricted_role
    );
  end loop;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant usage on schema public to service_role;
    revoke all privileges on table public.source_revisions from service_role;
    revoke all privileges on table public.source_revision_annotations
      from service_role;
    revoke all privileges on table public.deal_source_assignments
      from service_role;
    revoke all privileges on table public.intelligence_reports
      from service_role;
    revoke all privileges on table public.company_analyses
      from service_role;
    grant select on table public.source_revisions to service_role;
    grant select on table public.source_revision_annotations to service_role;
    grant select on table public.deal_source_assignments to service_role;
    grant select on table public.intelligence_reports to service_role;
    grant select on table public.company_analyses to service_role;
    revoke delete, truncate on table public.companies from service_role;
    revoke delete, truncate on table public.deals from service_role;
    revoke insert, update on table public.deals from service_role;
    grant insert (
      id, workspace_id, company_id, company_name, status, created_at
    ) on public.deals to service_role;
    grant update (
      company_id, company_name, status, created_at
    ) on public.deals to service_role;
    grant execute on function
      public.create_initial_source_revision(jsonb) to service_role;
    grant execute on function public.append_source_revision(jsonb)
      to service_role;
    grant execute on function public.annotate_source_revision(jsonb)
      to service_role;
    grant execute on function public.confirm_source_assignment(jsonb)
      to service_role;
    grant execute on function public.source_assignment_result(
      public.deals, public.source_revisions, text[], boolean
    ) to service_role;
    grant execute on function
      public.save_intelligence_report(jsonb, jsonb) to service_role;
    grant execute on function
      public.reset_intelligence_products(text) to service_role;
    grant execute on function
      public.get_analysis_eligible_snapshot(text) to service_role;
    revoke all on function
      public.save_intelligence_report_legacy_0009(jsonb, jsonb)
      from service_role;
  end if;
end;
$$;

commit;

notify pgrst, 'reload schema';
