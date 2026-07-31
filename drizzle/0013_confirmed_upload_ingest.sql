begin;

set local transaction isolation level read committed;

do $maintenance_locks$
declare
  app_table_name text;
begin
  foreach app_table_name in array array[
    'deals',
    'scan_runs',
    'source_documents',
    'source_evidence',
    'source_revisions',
    'uploaded_documents',
    'workspace_documents',
    'xtrace_ingest_jobs',
    'xtrace_memory_links'
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

grant create on schema public to vsee_registry_owner;

alter table public.uploaded_documents
  add column if not exists lease_token uuid,
  add column if not exists deal_id text,
  add column if not exists source_id text,
  add column if not exists source_revision_id text,
  add column if not exists confirmation_fingerprint text;

-- Active extraction and ingestion were rejected by the maintenance-quiescence
-- guard above. Older upload paths could nevertheless leave a worker id on a
-- queued or terminal row after clearing its lease expiry. Those fields no
-- longer represent live work, so remove the stale lease metadata without
-- changing the upload status, failure detail, or source identity.
update public.uploaded_documents
set worker_id = null,
    lease_token = null,
    lease_expires_at = null,
    updated_at = clock_timestamp()
where status not in ('extracting', 'ingesting_memory')
  and (
    worker_id is not null
    or lease_token is not null
    or lease_expires_at is not null
  );

-- Task 1 IDs embedded the workspace id. No Task 6 foreign keys exist yet, so
-- normalize staged IDs to content-derived opaque values before promotion.
update public.uploaded_documents
set id = 'upload_' || checksum
where id is distinct from 'upload_' || checksum;

alter table public.uploaded_documents
  add constraint uploaded_documents_workspace_deal_fkey
  foreign key (workspace_id, deal_id)
  references public.deals (workspace_id, id),
  add constraint uploaded_documents_exact_revision_fkey
  foreign key (workspace_id, source_id, source_revision_id)
  references public.source_revisions (workspace_id, source_id, id),
  add constraint uploaded_documents_confirmation_shape_check
  check (
    (
      confirmation_fingerprint is null
      and deal_id is null
      and source_id is null
      and source_revision_id is null
      and status in ('queued', 'extracting', 'awaiting_confirmation', 'failed')
    )
    or (
      confirmation_fingerprint ~ '^sha256:[0-9a-f]{64}$'
      and deal_id is not null
      and source_id is not null
      and source_revision_id is not null
      and status in ('confirmed', 'ingesting_memory', 'ready')
    )
  ),
  add constraint uploaded_documents_lease_shape_check
  check (
    (
      worker_id is null
      and lease_token is null
      and lease_expires_at is null
    )
    or (
      status in ('extracting', 'ingesting_memory')
      and btrim(coalesce(worker_id, '')) <> ''
      and lease_token is not null
      and lease_expires_at is not null
    )
  );

create unique index if not exists
  uploaded_documents_workspace_confirmation_unique
on public.uploaded_documents (workspace_id, id, confirmation_fingerprint)
where confirmation_fingerprint is not null;

alter table public.xtrace_ingest_jobs
  add column if not exists source_revision_ids jsonb
  not null default '[]'::jsonb
  check (jsonb_typeof(source_revision_ids) = 'array');

alter table public.xtrace_memory_links
  add column if not exists source_revision_ids jsonb
  not null default '[]'::jsonb
  check (jsonb_typeof(source_revision_ids) = 'array');

create or replace function public.claim_next_uploaded_document(
  p_target_status text,
  p_worker_id text,
  p_lease_seconds integer default 300
)
returns setof public.uploaded_documents
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed_status text;
  claimed public.uploaded_documents%rowtype;
begin
  if btrim(coalesce(p_worker_id, '')) = '' then
    raise exception 'A worker id is required';
  end if;
  if p_target_status = 'queued' then
    claimed_status := 'extracting';
  elsif p_target_status = 'confirmed' then
    claimed_status := 'ingesting_memory';
  else
    raise exception 'The upload claim target is invalid';
  end if;
  if p_lease_seconds < 1 or p_lease_seconds > 900 then
    raise exception 'The upload lease duration is invalid';
  end if;

  select upload.*
  into claimed
  from public.uploaded_documents as upload
  where upload.status = p_target_status
    or (
      upload.status = claimed_status
      and upload.lease_expires_at <= clock_timestamp()
    )
  order by upload.created_at, upload.workspace_id, upload.id
  for update skip locked
  limit 1;

  if not found then
    return;
  end if;

  update public.uploaded_documents as upload
  set status = claimed_status,
      worker_id = p_worker_id,
      lease_token = gen_random_uuid(),
      lease_expires_at =
        clock_timestamp() + make_interval(secs => p_lease_seconds),
      updated_at = clock_timestamp()
  where upload.workspace_id = claimed.workspace_id
    and upload.id = claimed.id
  returning upload.* into claimed;

  return next claimed;
end;
$$;

create or replace function public.renew_uploaded_document_lease(
  p_workspace_id text,
  p_upload_id text,
  p_worker_id text,
  p_lease_token uuid,
  p_lease_seconds integer default 300
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  renewed_count integer;
begin
  if p_lease_seconds < 1 or p_lease_seconds > 900 then
    raise exception 'The upload lease duration is invalid';
  end if;
  update public.uploaded_documents as upload
  set lease_expires_at =
        clock_timestamp() + make_interval(secs => p_lease_seconds),
      updated_at = clock_timestamp()
  where upload.workspace_id = p_workspace_id
    and upload.id = p_upload_id
    and upload.status in ('extracting', 'ingesting_memory')
    and upload.worker_id = p_worker_id
    and upload.lease_token = p_lease_token
    and upload.lease_expires_at > clock_timestamp();
  get diagnostics renewed_count = row_count;
  return renewed_count = 1;
end;
$$;

create or replace function public.transition_uploaded_document_lease(
  p_workspace_id text,
  p_upload_id text,
  p_worker_id text,
  p_lease_token uuid,
  p_transition text,
  p_extraction_preview jsonb,
  p_failure_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  transitioned_count integer;
begin
  if btrim(coalesce(p_workspace_id, '')) = ''
    or btrim(coalesce(p_upload_id, '')) = ''
    or btrim(coalesce(p_worker_id, '')) = ''
    or p_lease_token is null
  then
    raise exception 'A complete upload lease identity is required';
  end if;
  if p_transition is null
    or p_transition not in (
      'extraction_complete',
      'extraction_fail',
      'confirmed_complete',
      'confirmed_fail'
    )
  then
    raise exception 'The upload lease transition is invalid';
  end if;
  if p_transition = 'extraction_complete'
    and coalesce(jsonb_typeof(p_extraction_preview), 'null') <> 'object'
  then
    raise exception 'Extraction completion requires a preview object';
  end if;
  if p_transition in ('extraction_fail', 'confirmed_fail')
    and btrim(coalesce(p_failure_reason, '')) = ''
  then
    raise exception 'A failure reason is required';
  end if;

  update public.uploaded_documents as upload
  set status = case p_transition
        when 'extraction_complete' then 'awaiting_confirmation'
        when 'extraction_fail' then 'failed'
        when 'confirmed_complete' then 'ready'
        when 'confirmed_fail' then 'confirmed'
      end,
      failure_reason = case
        when p_transition in ('extraction_fail', 'confirmed_fail')
          then left(p_failure_reason, 400)
        else null
      end,
      extraction_preview = case
        when p_transition = 'extraction_complete'
          then p_extraction_preview
        else upload.extraction_preview
      end,
      worker_id = null,
      lease_token = null,
      lease_expires_at = null,
      updated_at = clock_timestamp()
  where upload.workspace_id = p_workspace_id
    and upload.id = p_upload_id
    and upload.status = case
      when p_transition in ('extraction_complete', 'extraction_fail')
        then 'extracting'
      else 'ingesting_memory'
    end
    and upload.worker_id = p_worker_id
    and upload.lease_token = p_lease_token
    and upload.lease_expires_at > clock_timestamp();
  get diagnostics transitioned_count = row_count;
  return transitioned_count = 1;
end;
$$;

create or replace function public.confirm_uploaded_document(
  p_confirmation jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_workspace_id text :=
    btrim(p_confirmation ->> 'workspaceId');
  target_upload_id text := btrim(p_confirmation ->> 'uploadId');
  target_fingerprint text :=
    btrim(p_confirmation ->> 'confirmationFingerprint');
  target_deal_id text := btrim(p_confirmation ->> 'dealId');
  target_company_id text := btrim(p_confirmation ->> 'companyId');
  target_company_name text := btrim(p_confirmation ->> 'companyName');
  target_deal_status text := btrim(p_confirmation ->> 'dealStatus');
  target_source_id text := btrim(p_confirmation ->> 'sourceId');
  target_revision_id text :=
    btrim(p_confirmation ->> 'sourceRevisionId');
  target_user_id text :=
    btrim(p_confirmation ->> 'assignedByUserId');
  target_confirmed_at timestamptz :=
    (p_confirmation ->> 'confirmedAt')::timestamptz;
  upload public.uploaded_documents%rowtype;
  updated_upload public.uploaded_documents%rowtype;
  preview_metadata jsonb;
  evidence_item jsonb;
begin
  if jsonb_typeof(p_confirmation) <> 'object' then
    raise exception 'p_confirmation must be a JSON object';
  end if;
  if coalesce(target_workspace_id, '') = ''
    or coalesce(target_upload_id, '') = ''
    or coalesce(target_deal_id, '') = ''
    or coalesce(target_company_id, '') = ''
    or coalesce(target_company_name, '') = ''
    or coalesce(target_source_id, '') = ''
    or coalesce(target_revision_id, '') = ''
    or coalesce(target_user_id, '') = ''
  then
    raise exception 'The complete upload confirmation identity is required';
  end if;
  if target_fingerprint !~ '^sha256:[0-9a-f]{64}$' then
    raise exception 'The upload confirmation fingerprint is invalid';
  end if;
  if target_deal_status not in (
    'screening', 'watchlist', 'evaluating', 'passed', 'invested'
  ) then
    raise exception 'The Deal status is invalid';
  end if;
  if jsonb_typeof(coalesce(p_confirmation -> 'evidence', '[]'::jsonb))
    <> 'array'
  then
    raise exception 'Upload evidence must be an array';
  end if;
  if jsonb_array_length(coalesce(p_confirmation -> 'evidence', '[]'::jsonb)) = 0
  then
    raise exception 'Upload confirmation requires source-backed evidence';
  end if;

  select candidate.*
  into upload
  from public.uploaded_documents as candidate
  where candidate.workspace_id = target_workspace_id
    and candidate.id = target_upload_id
  for update;
  if not found then
    raise exception 'Upload was not found';
  end if;
  if upload.confirmation_fingerprint is not null then
    if upload.confirmation_fingerprint <> target_fingerprint
      or upload.deal_id <> target_deal_id
      or upload.source_id <> target_source_id
      or upload.source_revision_id <> target_revision_id
    then
      raise exception
        'The upload was already confirmed with a different confirmation';
    end if;
    return jsonb_build_object('upload', to_jsonb(upload));
  end if;
  if upload.status <> 'awaiting_confirmation'
    or upload.extraction_preview is null
  then
    raise exception 'The upload is not awaiting confirmation';
  end if;

  preview_metadata := upload.extraction_preview -> 'extractionMetadata';
  if preview_metadata is null then
    raise exception 'The upload extraction metadata is missing';
  end if;

  insert into public.source_documents (
    id, filename, title, role, company_name, deal_id, checksum, byte_size,
    object_key, created_at
  ) values (
    target_source_id,
    upload.filename,
    upload.filename,
    'deal_document',
    target_company_name,
    target_deal_id,
    target_fingerprint,
    upload.byte_size,
    upload.object_key,
    target_confirmed_at
  );
  insert into public.workspace_documents (workspace_id, document_id)
  values (target_workspace_id, target_source_id);

  perform public.create_initial_source_revision(jsonb_build_object(
    'id', target_revision_id,
    'workspaceId', target_workspace_id,
    'sourceId', target_source_id,
    'contentHash', upload.checksum,
    'objectKey', upload.object_key,
    'objectVersion', upload.checksum,
    'contentType', upload.content_type,
    'extractorId', preview_metadata ->> 'extractorId',
    'extractorVersion', preview_metadata ->> 'extractorVersion',
    'extractedAt', preview_metadata ->> 'extractedAt',
    'createdAt', target_confirmed_at
  ));

  perform public.confirm_source_assignment(jsonb_build_object(
    'requestId',
      'upload-confirmation:' || target_upload_id || ':' || upload.checksum,
    'workspaceId', target_workspace_id,
    'dealId', target_deal_id,
    'companyId', target_company_id,
    'companyName', target_company_name,
    'status', target_deal_status,
    'sourceRevisionId', target_revision_id,
    'assignedByUserId', target_user_id,
    'reason', 'User confirmed runtime upload identity and Deal assignment.',
    'confirmedAt', target_confirmed_at
  ));

  for evidence_item in
    select value
    from jsonb_array_elements(
      coalesce(p_confirmation -> 'evidence', '[]'::jsonb)
    )
  loop
    insert into public.source_evidence (
      id, workspace_id, document_id, source_revision_id, deal_id,
      company_name, provenance, page, fact, excerpt, created_at
    ) values (
      btrim(evidence_item ->> 'id'),
      target_workspace_id,
      target_source_id,
      target_revision_id,
      target_deal_id,
      target_company_name,
      'source_document',
      (evidence_item ->> 'page')::integer,
      btrim(evidence_item ->> 'fact'),
      btrim(evidence_item ->> 'excerpt'),
      target_confirmed_at
    );
  end loop;

  update public.uploaded_documents as target
  set status = 'confirmed',
      failure_reason = null,
      deal_id = target_deal_id,
      source_id = target_source_id,
      source_revision_id = target_revision_id,
      confirmation_fingerprint = target_fingerprint,
      worker_id = null,
      lease_token = null,
      lease_expires_at = null,
      updated_at = clock_timestamp()
  where target.workspace_id = target_workspace_id
    and target.id = target_upload_id
  returning target.* into updated_upload;

  return jsonb_build_object('upload', to_jsonb(updated_upload));
end;
$$;

alter function public.claim_next_uploaded_document(text, text, integer)
  owner to vsee_registry_owner;
alter function public.renew_uploaded_document_lease(
  text, text, text, uuid, integer
) owner to vsee_registry_owner;
alter function public.transition_uploaded_document_lease(
  text, text, text, uuid, text, jsonb, text
) owner to vsee_registry_owner;
alter function public.confirm_uploaded_document(jsonb)
  owner to vsee_registry_owner;

grant select, update on public.uploaded_documents to vsee_registry_owner;
grant select, insert on public.source_documents to vsee_registry_owner;
grant select, insert on public.workspace_documents to vsee_registry_owner;
grant select, insert on public.source_evidence to vsee_registry_owner;

create policy uploaded_documents_registry_owner
  on public.uploaded_documents for all to vsee_registry_owner
  using (true) with check (true);
create policy source_documents_upload_registry_owner
  on public.source_documents for all to vsee_registry_owner
  using (true) with check (true);
create policy workspace_documents_upload_registry_owner
  on public.workspace_documents for all to vsee_registry_owner
  using (true) with check (true);
create policy source_evidence_upload_registry_owner
  on public.source_evidence for all to vsee_registry_owner
  using (true) with check (true);

revoke all on function
  public.claim_next_uploaded_document(text, text, integer) from public;
revoke all on function
  public.renew_uploaded_document_lease(text, text, text, uuid, integer)
  from public;
revoke all on function public.transition_uploaded_document_lease(
  text, text, text, uuid, text, jsonb, text
) from public;
revoke all on function public.confirm_uploaded_document(jsonb) from public;

do $$
declare
  restricted_role text;
begin
  for restricted_role in
    select rolname from pg_roles
    where rolname in ('anon', 'authenticated')
  loop
    execute format(
      'revoke all on function public.claim_next_uploaded_document(text, text, integer) from %I',
      restricted_role
    );
    execute format(
      'revoke all on function public.renew_uploaded_document_lease(text, text, text, uuid, integer) from %I',
      restricted_role
    );
    execute format(
      'revoke all on function public.transition_uploaded_document_lease(text, text, text, uuid, text, jsonb, text) from %I',
      restricted_role
    );
    execute format(
      'revoke all on function public.confirm_uploaded_document(jsonb) from %I',
      restricted_role
    );
  end loop;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function
      public.claim_next_uploaded_document(text, text, integer)
      to service_role;
    grant execute on function
      public.renew_uploaded_document_lease(text, text, text, uuid, integer)
      to service_role;
    grant execute on function public.transition_uploaded_document_lease(
      text, text, text, uuid, text, jsonb, text
    ) to service_role;
    grant execute on function public.confirm_uploaded_document(jsonb)
      to service_role;
  end if;
end;
$$;

revoke create on schema public from vsee_registry_owner;

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

commit;

notify pgrst, 'reload schema';
