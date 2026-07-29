begin;

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

create or replace function public.validate_source_revision_insert()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
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
set search_path = pg_catalog, public
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
security invoker
set search_path = pg_catalog, public
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
security invoker
set search_path = pg_catalog, public
as $$
declare
  target_workspace_id text := btrim(p_revision ->> 'workspaceId');
  target_source_id text := btrim(p_revision ->> 'sourceId');
  target_revision_id text := btrim(p_revision ->> 'id');
  target_supersedes_id text := btrim(p_revision ->> 'supersedesRevisionId');
  current_revision public.source_revisions%rowtype;
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
  id, request_id, workspace_id, deal_id, source_id, source_revision_id,
  assigned_by_user_id, reason, created_at, superseded_at
)
select
  'backfill:' || md5(
    ownership.workspace_id || ':' || ownership.deal_id || ':'
      || ownership.source_id
  ),
  'backfill:' || ownership.deal_id || ':' || ownership.source_id,
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

update public.deals as deal
set
  analysis_eligible_at = coalesce(
    deal.analysis_eligible_at,
    active.first_assignment_at
  ),
  active_source_revision_fingerprint =
    'source-revisions-v1:' || active.revision_ids
from (
  select assignment.workspace_id, assignment.deal_id,
    min(assignment.created_at) as first_assignment_at,
    string_agg(
      assignment.source_revision_id,
      ',' order by assignment.source_revision_id
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
set search_path = pg_catalog, public
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
security invoker
set search_path = pg_catalog, public
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
    if existing_request.deal_id <> target_deal_id
      or existing_request.source_revision_id <> target_revision_id
    then
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
      id, request_id, workspace_id, deal_id, source_id,
      source_revision_id, assigned_by_user_id, reason, created_at
    ) values (
      'assignment:' || md5(target_workspace_id || ':' || target_request_id),
      target_request_id,
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
      order by assignment.source_revision_id
    ),
    'source-revisions-v1:' || string_agg(
      assignment.source_revision_id,
      ',' order by assignment.source_revision_id
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

alter table public.source_revisions enable row level security;
alter table public.source_revision_annotations enable row level security;
alter table public.deal_source_assignments enable row level security;

revoke all privileges on table public.source_revisions from public;
revoke all privileges on table public.source_revision_annotations from public;
revoke all privileges on table public.deal_source_assignments from public;
revoke all on function public.create_initial_source_revision(jsonb)
  from public;
revoke all on function public.append_source_revision(jsonb) from public;
revoke all on function public.confirm_source_assignment(jsonb) from public;
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
      'revoke all on function public.confirm_source_assignment(jsonb) from %I',
      restricted_role
    );
  end loop;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant usage on schema public to service_role;
    grant all privileges on table public.source_revisions to service_role;
    grant all privileges on table public.source_revision_annotations
      to service_role;
    grant all privileges on table public.deal_source_assignments
      to service_role;
    grant execute on function
      public.create_initial_source_revision(jsonb) to service_role;
    grant execute on function public.append_source_revision(jsonb)
      to service_role;
    grant execute on function public.confirm_source_assignment(jsonb)
      to service_role;
    grant execute on function public.source_assignment_result(
      public.deals, public.source_revisions, text[], boolean
    ) to service_role;
  end if;
end;
$$;

commit;

notify pgrst, 'reload schema';
