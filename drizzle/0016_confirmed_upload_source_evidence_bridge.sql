begin;

set local transaction isolation level read committed;

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

grant create on schema public to vsee_underwriting_owner;
grant create on schema public to vsee_registry_owner;

lock table
  public.action_drafts,
  public.candidate_runs,
  public.company_analyses,
  public.intelligence_reports,
  public.scan_runs,
  public.source_documents,
  public.source_evidence,
  public.source_evidence_items,
  public.source_revisions,
  public.underwriting_batches,
  public.uploaded_documents,
  public.workspace_documents,
  public.xtrace_ingest_jobs,
  public.xtrace_memory_links
in access exclusive mode;

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

alter table public.source_documents
  drop constraint if exists source_documents_checksum_key;
create index if not exists source_documents_checksum_idx
  on public.source_documents (checksum);

update public.source_documents as document
set checksum = upload.checksum
from public.uploaded_documents as upload
where upload.source_id = document.id
  and upload.confirmation_fingerprint is not null
  and document.checksum is distinct from upload.checksum;

alter table public.source_evidence
  add column if not exists analysis_quarantine_reason text;
alter table public.source_evidence
  drop constraint if exists source_evidence_analysis_quarantine_reason_check;
alter table public.source_evidence
  add constraint source_evidence_analysis_quarantine_reason_check
  check (
    analysis_quarantine_reason is null
    or analysis_quarantine_reason = 'legacy_model_derived_image_summary'
  );

-- Under immutable 0013, image facts had no verbatim excerpt. The application
-- substituted the vision-model summary into the legacy excerpt column before
-- confirmation, so those rows cannot be distinguished from quotations later.
-- Preserve the full row and lineage for audit/UI, but explicitly quarantine it
-- from Deal memory and XTrace.
update public.source_evidence as evidence
set analysis_quarantine_reason = 'legacy_model_derived_image_summary'
from public.source_revisions as revision,
     public.uploaded_documents as upload
where revision.workspace_id = evidence.workspace_id
  and revision.source_id = evidence.document_id
  and revision.id = evidence.source_revision_id
  and upload.workspace_id = evidence.workspace_id
  and upload.source_id = evidence.document_id
  and upload.source_revision_id = evidence.source_revision_id
  and upload.confirmation_fingerprint is not null
  and revision.content_type like 'image/%'
  and upload.content_type = revision.content_type;

alter table public.source_evidence_items
  add column if not exists source_id text;

update public.source_evidence_items as evidence
set source_id = revision.source_id,
    payload = jsonb_set(
      evidence.payload,
      '{sourceId}',
      to_jsonb(revision.source_id),
      true
    )
from public.source_revisions as revision
where revision.workspace_id = evidence.workspace_id
  and revision.id = evidence.source_revision_id
  and (
    evidence.source_id is null
    or evidence.payload ->> 'sourceId' is distinct from revision.source_id
  );

alter table public.source_evidence_items
  drop constraint if exists source_evidence_items_payload_identity_check,
  drop constraint if exists source_evidence_items_exact_revision_fkey;
alter table public.source_evidence_items
  alter column source_id set not null;
alter table public.source_evidence_items
  add constraint source_evidence_items_payload_identity_check
  check (
    coalesce(
      payload ->> 'id' = evidence_id
      and payload ->> 'workspaceId' = workspace_id
      and payload ->> 'dealId' = deal_id
      and payload ->> 'sourceId' = source_id
      and payload ->> 'sourceRevisionId' = source_revision_id,
      false
    )
  ),
  add constraint source_evidence_items_exact_revision_fkey
  foreign key (workspace_id, source_id, source_revision_id)
  references public.source_revisions (workspace_id, source_id, id);

-- Confirmations performed by immutable migration 0013 only wrote the legacy
-- source_evidence table. Text uploads preserve an exact persisted excerpt, so
-- they can be bridged conservatively into the canonical evidence catalog.
-- Legacy image uploads are intentionally excluded: before this migration the
-- vision-model summary occupied the excerpt column and cannot be distinguished
-- reliably from a verbatim quote after the fact.
insert into public.source_evidence_items (
  workspace_id, evidence_id, deal_id, source_id, source_revision_id,
  payload, created_at
)
select
  evidence.workspace_id,
  evidence.id,
  evidence.deal_id,
  evidence.document_id,
  evidence.source_revision_id,
  jsonb_build_object(
    'id', evidence.id,
    'workspaceId', evidence.workspace_id,
    'dealId', evidence.deal_id,
    'sourceId', evidence.document_id,
    'sourceRevisionId', evidence.source_revision_id,
    'provenanceOrigin', 'uploaded_document',
    'field', 'unstructured_source_fact',
    'value', evidence.fact,
    'unit', null,
    'currency', null,
    'periodStart', null,
    'periodEnd', null,
    'publishedAt', null,
    'eventAt', null,
    'retrievedAt', to_char(
      revision.extracted_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'locator', jsonb_build_object(
      'kind', 'pdf_page',
      'page', evidence.page,
      'excerpt', evidence.excerpt
    ),
    'sourceRole', 'management',
    'assertionStatus', 'reported',
    'verificationMethod', null,
    'freshness', 'current',
    'acceptedForGate', false
  ),
  evidence.created_at
from public.source_evidence as evidence
join public.source_revisions as revision
  on revision.workspace_id = evidence.workspace_id
  and revision.source_id = evidence.document_id
  and revision.id = evidence.source_revision_id
join public.uploaded_documents as upload
  on upload.workspace_id = evidence.workspace_id
  and upload.source_id = evidence.document_id
  and upload.source_revision_id = evidence.source_revision_id
  and upload.confirmation_fingerprint is not null
where evidence.provenance = 'source_document'
  and revision.content_type in ('text/plain', 'text/markdown')
  and upload.content_type = revision.content_type
  and btrim(evidence.fact) <> ''
  and btrim(evidence.excerpt) <> ''
on conflict (workspace_id, evidence_id) do nothing;

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
  v_source_id text;
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
    v_source_id := btrim(item ->> 'sourceId');
    v_revision_id := btrim(item ->> 'sourceRevisionId');
    if coalesce(v_workspace_id, '') = ''
      or coalesce(v_evidence_id, '') = ''
      or coalesce(v_deal_id, '') = ''
      or coalesce(v_source_id, '') = ''
      or coalesce(v_revision_id, '') = ''
    then
      raise exception 'Source evidence identity is required';
    end if;

    insert into public.source_evidence_items (
      workspace_id, evidence_id, deal_id, source_id, source_revision_id,
      payload
    ) values (
      v_workspace_id, v_evidence_id, v_deal_id, v_source_id, v_revision_id,
      item
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
  structured_item jsonb;
  canonical_item jsonb;
  structured_complete boolean;
  structured_category text;
  structured_field text;
  normalized_field text;
  normalized_unit text;
  structured_value text;
  structured_currency text;
  evidence_excerpt text;
  period_start_value text;
  period_end_value text;
  published_at_value text;
  event_at_value text;
  source_supported_value text;
  source_supported_position integer;
  source_search_from integer;
  source_relative_position integer;
  source_has_valid_occurrence boolean;
  image_located boolean;
  structured_trim_characters constant text :=
    ' '
    || pg_catalog.chr(9)
    || pg_catalog.chr(10)
    || pg_catalog.chr(11)
    || pg_catalog.chr(12)
    || pg_catalog.chr(13);
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
    upload.checksum,
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
    structured_item := evidence_item -> 'structured';
    structured_field := btrim(
      coalesce(structured_item ->> 'field', ''),
      structured_trim_characters
    );
    normalized_field := btrim(regexp_replace(
      regexp_replace(
        lower(structured_field),
        '[^a-z0-9]+',
        ' ',
        'g'
      ),
      '[[:space:]]+',
      ' ',
      'g'
    ));
    -- Mirror the closed formal field catalog in upload confirmation.
    structured_category := case
      when normalized_field in (
        'annual recurring revenue', 'arr', 'sales pipeline', 'pipeline',
        'gross merchandise value', 'gmv', 'total revenue', 'revenue',
        'recurring revenue', 'subscription revenue',
        'professional services revenue', 'services revenue',
        'pass through revenue', 'pre money valuation',
        'post money valuation', 'reported valuation', 'round price'
      ) then 'currency'
      when normalized_field in (
        'yoy growth', 'year over year growth', 'growth'
      ) then 'rate'
      when normalized_field in (
        'company identity', 'company id', 'valuation basis', 'stage',
        'business model', 'geography', 'security type'
      ) then 'text'
      else null
    end;
    normalized_unit := nullif(
      lower(btrim(
        coalesce(structured_item ->> 'unit', ''),
        structured_trim_characters
      )),
      ''
    );
    structured_value := btrim(
      coalesce(structured_item ->> 'value', ''),
      structured_trim_characters
    );
    structured_currency := nullif(
      btrim(
        coalesce(structured_item ->> 'currency', ''),
        structured_trim_characters
      ),
      ''
    );
    evidence_excerpt := btrim(
      coalesce(evidence_item ->> 'excerpt', ''),
      structured_trim_characters
    );
    image_located :=
      jsonb_typeof(evidence_item -> 'locator') = 'object'
      and evidence_item #>> '{locator,kind}' = 'image'
      and coalesce(evidence_item #>> '{locator,imageIndex}', '')
        ~ '^[0-9]+$'
      and (evidence_item -> 'locator') ? 'region'
      and evidence_item #> '{locator,region}' = 'null'::jsonb;
    period_start_value := nullif(
      btrim(
        coalesce(structured_item ->> 'periodStart', ''),
        structured_trim_characters
      ),
      ''
    );
    period_end_value := nullif(
      btrim(
        coalesce(structured_item ->> 'periodEnd', ''),
        structured_trim_characters
      ),
      ''
    );
    published_at_value := nullif(
      btrim(
        coalesce(structured_item ->> 'publishedAt', ''),
        structured_trim_characters
      ),
      ''
    );
    event_at_value := nullif(
      btrim(
        coalesce(structured_item ->> 'eventAt', ''),
        structured_trim_characters
      ),
      ''
    );
    structured_complete :=
      jsonb_typeof(structured_item) = 'object'
      and structured_field <> ''
      and structured_value <> ''
      and (evidence_excerpt <> '' or image_located)
      and structured_category is not null
      and (
        (
          structured_category = 'currency'
          and normalized_unit = 'currency'
          and structured_currency = 'USD'
          and structured_value ~
            '^([+-]?[$]?(([0-9]{1,3}(,[0-9]{3})+|[0-9]+)([.][0-9]*)?|[.][0-9]+)([\u0009-\u000d\u0020]*USD)?|[(][$]?(([0-9]{1,3}(,[0-9]{3})+|[0-9]+)([.][0-9]*)?|[.][0-9]+)([\u0009-\u000d\u0020]*USD)?[)])$'
        )
        or (
          structured_category = 'rate'
          and normalized_unit = 'percent'
          and structured_currency is null
          and structured_value ~
            '^[+-]?(([0-9]{1,3}(,[0-9]{3})+|[0-9]+)([.][0-9]*)?|[.][0-9]+)%?$'
        )
        or (
          structured_category = 'text'
          and normalized_unit is null
          and structured_currency is null
        )
      )
      and (
        (
          period_start_value is null
          and period_end_value is null
        )
        or (
          period_start_value is not null
          and period_end_value is not null
        )
      );
    if structured_complete and not image_located then
      foreach source_supported_value in array array[
        structured_field,
        structured_value,
        case
          when structured_category = 'currency' then structured_currency
          when structured_category = 'rate'
            and right(structured_value, 1) <> '%'
          then 'percent'
          else null
        end,
        period_start_value,
        period_end_value,
        published_at_value,
        event_at_value
      ]
      loop
        continue when source_supported_value is null;
        source_search_from := 1;
        source_has_valid_occurrence := false;
        loop
          source_relative_position := position(
            lower(source_supported_value)
            in substring(lower(evidence_excerpt) from source_search_from)
          );
          exit when source_relative_position = 0;
          source_supported_position :=
            source_search_from + source_relative_position - 1;
          source_has_valid_occurrence :=
            (
              substring(source_supported_value from 1 for 1)
                !~ '[A-Za-z0-9]'
              or source_supported_position = 1
              or substring(
                evidence_excerpt
                from source_supported_position - 1
                for 1
              ) !~ '[A-Za-z0-9]'
            )
            and (
              substring(
                source_supported_value
                from char_length(source_supported_value)
                for 1
              ) !~ '[A-Za-z0-9]'
              or source_supported_position
                  + char_length(source_supported_value)
                > char_length(evidence_excerpt)
              or substring(
                evidence_excerpt
                from source_supported_position
                  + char_length(source_supported_value)
                for 1
              ) !~ '[A-Za-z0-9]'
            );
          exit when source_has_valid_occurrence;
          source_search_from := source_supported_position + 1;
        end loop;
        if not source_has_valid_occurrence then
          structured_complete := false;
          exit;
        end if;
      end loop;
    end if;
    if structured_complete then
      begin
        structured_complete :=
          (
            period_start_value is null
            or (
              period_start_value ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
              and period_start_value !~ '^0000-'
              and to_char(
                period_start_value::date,
                'YYYY-MM-DD'
              ) = period_start_value
            )
          )
          and (
            period_end_value is null
            or (
              period_end_value ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
              and period_end_value !~ '^0000-'
              and to_char(
                period_end_value::date,
                'YYYY-MM-DD'
              ) = period_end_value
            )
          )
          and (
            period_start_value is null
            or period_end_value::date >= period_start_value::date
          )
          and (
            published_at_value is null
            or (
              published_at_value ~
                '^([0-9]{4}-[0-9]{2}-[0-9]{2})T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]+)?(Z|[+-](0[0-9]|1[0-3]):[0-5][0-9]|[+-]14:00)$'
              and substring(published_at_value from 1 for 4) <> '0000'
              and to_char(
                substring(published_at_value from 1 for 10)::date,
                'YYYY-MM-DD'
              ) = substring(published_at_value from 1 for 10)
              and published_at_value::timestamptz is not null
            )
          )
          and (
            event_at_value is null
            or (
              event_at_value ~
                '^([0-9]{4}-[0-9]{2}-[0-9]{2})T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]+)?(Z|[+-](0[0-9]|1[0-3]):[0-5][0-9]|[+-]14:00)$'
              and substring(event_at_value from 1 for 4) <> '0000'
              and to_char(
                substring(event_at_value from 1 for 10)::date,
                'YYYY-MM-DD'
              ) = substring(event_at_value from 1 for 10)
              and event_at_value::timestamptz is not null
            )
          );
      exception
        when others then
          structured_complete := false;
      end;
    end if;
    canonical_item := jsonb_build_object(
      'id', btrim(evidence_item ->> 'id'),
      'workspaceId', target_workspace_id,
      'dealId', target_deal_id,
      'sourceId', target_source_id,
      'sourceRevisionId', target_revision_id,
      'provenanceOrigin', 'uploaded_document',
      'field', case
        when structured_complete then structured_field
        else 'unstructured_source_fact'
      end,
      'value', case
        when structured_complete then structured_value
        else btrim(evidence_item ->> 'fact')
      end,
      'unit', case
        when structured_complete then to_jsonb(normalized_unit)
        else 'null'::jsonb
      end,
      'currency', case
        when structured_complete then to_jsonb(structured_currency)
        else 'null'::jsonb
      end,
      'periodStart', case
        when structured_complete then to_jsonb(period_start_value)
        else 'null'::jsonb
      end,
      'periodEnd', case
        when structured_complete then to_jsonb(period_end_value)
        else 'null'::jsonb
      end,
      'publishedAt', case
        when structured_complete then to_jsonb(published_at_value)
        else 'null'::jsonb
      end,
      'eventAt', case
        when structured_complete then to_jsonb(event_at_value)
        else 'null'::jsonb
      end,
      'retrievedAt', preview_metadata ->> 'extractedAt',
      'locator', coalesce(
        evidence_item -> 'locator',
        jsonb_build_object(
          'kind', 'pdf_page',
          'page', (evidence_item ->> 'page')::integer,
          'excerpt', btrim(evidence_item ->> 'excerpt')
        )
      ),
      'sourceRole', 'management',
      'assertionStatus', 'reported',
      'verificationMethod', null,
      'freshness', 'current',
      'acceptedForGate', structured_complete
    );
    if evidence_excerpt <> '' and not image_located then
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
        evidence_excerpt,
        target_confirmed_at
      );
    end if;
    insert into public.source_evidence_items (
      workspace_id, evidence_id, deal_id, source_id, source_revision_id,
      payload, created_at
    ) values (
      target_workspace_id,
      btrim(evidence_item ->> 'id'),
      target_deal_id,
      target_source_id,
      target_revision_id,
      canonical_item,
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

alter function public.confirm_uploaded_document(jsonb)
  owner to vsee_registry_owner;

grant select, insert on public.source_evidence_items to vsee_registry_owner;

drop policy if exists source_evidence_items_upload_registry_owner
  on public.source_evidence_items;
create policy source_evidence_items_upload_registry_owner
  on public.source_evidence_items for all to vsee_registry_owner
  using (true) with check (true);

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
      'revoke all on function public.confirm_uploaded_document(jsonb) from %I',
      restricted_role
    );
  end loop;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    -- Runtime upload staging inserts only immutable source metadata. Every
    -- lifecycle mutation (claim, lease renewal, transition, confirmation)
    -- must pass through the controlled security-definer functions below.
    revoke all privileges on table public.uploaded_documents
      from service_role;
    grant select on table public.uploaded_documents to service_role;
    grant insert (
      id, workspace_id, filename, content_type, byte_size, checksum,
      object_key
    ) on table public.uploaded_documents to service_role;

    -- The bundled corpus loader still needs idempotent immutable INSERTs for
    -- preloaded PDF catalog rows and exact legacy excerpts. It now uses
    -- ON CONFLICT DO NOTHING, so no UPDATE right is needed. These grants cannot
    -- create canonical runtime-upload evidence: source_evidence_items remains
    -- read-only and is written only by controlled RPCs.
    revoke all privileges on table public.source_documents
      from service_role;
    grant select on table public.source_documents to service_role;
    grant insert (
      id, filename, title, role, company_name, deal_id, checksum, byte_size,
      object_key
    ) on table public.source_documents to service_role;

    revoke all privileges on table public.workspace_documents
      from service_role;
    grant select on table public.workspace_documents to service_role;
    grant insert (
      workspace_id, document_id
    ) on table public.workspace_documents to service_role;

    revoke all privileges on table public.source_evidence
      from service_role;
    grant select on table public.source_evidence to service_role;
    grant insert (
      id, workspace_id, document_id, source_revision_id, deal_id,
      company_name, provenance, page, fact, excerpt
    ) on table public.source_evidence to service_role;

    revoke all privileges on table public.source_evidence_items
      from service_role;
    grant select on table public.source_evidence_items to service_role;

    grant execute on function public.confirm_uploaded_document(jsonb)
      to service_role;
  end if;
end;
$$;

-- Rows quarantined above may already have produced durable reports or XTrace
-- memory before this upgrade. Invalidate only products carrying the exact
-- quarantined evidence/revision lineage; clean text products remain intact.
alter table public.uploaded_documents
  drop constraint if exists uploaded_documents_confirmation_shape_check;
alter table public.uploaded_documents
  add constraint uploaded_documents_confirmation_shape_check
  check (
    (
      confirmation_fingerprint is null
      and deal_id is null
      and source_id is null
      and source_revision_id is null
      and status in (
        'queued', 'extracting', 'awaiting_confirmation', 'failed'
      )
    )
    or (
      confirmation_fingerprint ~ '^sha256:[0-9a-f]{64}$'
      and deal_id is not null
      and source_id is not null
      and source_revision_id is not null
      and (
        status in ('confirmed', 'ingesting_memory', 'ready')
        or (
          status = 'failed'
          and content_type like 'image/%'
          and failure_reason =
            'Legacy image evidence was quarantined because the prior '
            || 'vision-model summary was not an exact quotation. '
            || 'Upload the image again before using it for analysis.'
        )
      )
    )
  );

update public.uploaded_documents as upload
set status = 'failed',
    failure_reason =
      'Legacy image evidence was quarantined because the prior '
      || 'vision-model summary was not an exact quotation. '
      || 'Upload the image again before using it for analysis.',
    worker_id = null,
    lease_token = null,
    lease_expires_at = null,
    updated_at = clock_timestamp()
from public.source_evidence as evidence
where evidence.analysis_quarantine_reason =
    'legacy_model_derived_image_summary'
  and upload.workspace_id = evidence.workspace_id
  and upload.deal_id = evidence.deal_id
  and upload.source_id = evidence.document_id
  and upload.source_revision_id = evidence.source_revision_id
  and upload.confirmation_fingerprint is not null
  and upload.status in (
    'confirmed', 'ingesting_memory', 'ready', 'failed'
  );

delete from public.xtrace_memory_links as memory
using public.source_evidence as evidence
where evidence.analysis_quarantine_reason =
    'legacy_model_derived_image_summary'
  and memory.workspace_id = evidence.workspace_id
  and memory.deal_id = evidence.deal_id
  and memory.source_ids @> jsonb_build_array(evidence.document_id)
  and memory.source_revision_ids
    @> jsonb_build_array(evidence.source_revision_id);

delete from public.xtrace_ingest_jobs as job
using public.source_evidence as evidence
where evidence.analysis_quarantine_reason =
    'legacy_model_derived_image_summary'
  and job.workspace_id = evidence.workspace_id
  and job.deal_id = evidence.deal_id
  and job.source_ids @> jsonb_build_array(evidence.document_id)
  and job.source_revision_ids
    @> jsonb_build_array(evidence.source_revision_id);

-- Capture the precise report/run lineage before report deletion. A report is
-- polluted only when its own persisted analysis or opportunity cites the
-- exact quarantined evidence id for the same workspace and deal.
create temporary table quarantined_legacy_image_report_runs
on commit drop
as
select distinct
  report.id as report_id,
  report.workspace_id,
  report.run_id
from public.intelligence_reports as report
where exists (
    select 1
    from public.company_analyses as analysis
    join public.source_evidence as evidence
      on evidence.workspace_id = analysis.workspace_id
      and evidence.deal_id = analysis.deal_id
      and evidence.analysis_quarantine_reason =
        'legacy_model_derived_image_summary'
    where analysis.workspace_id = report.workspace_id
      and analysis.report_id = report.id
      and analysis.source_refs
        @> jsonb_build_array(jsonb_build_object('id', evidence.id))
  )
  or exists (
    select 1
    from public.source_evidence as evidence
    where evidence.workspace_id = report.workspace_id
      and evidence.analysis_quarantine_reason =
        'legacy_model_derived_image_summary'
      and report.opportunities @> jsonb_build_array(jsonb_build_object(
        'dealId', evidence.deal_id,
        'sources', jsonb_build_array(jsonb_build_object(
          'id', evidence.id
        ))
      ))
  );

-- Finalized underwriting artifacts remain immutable audit records. Make every
-- candidate in a batch derived from the polluted scan run unavailable,
-- including rerun aliases, so none can be displayed, searched, or reused.
update public.candidate_runs as candidate
set status = 'unavailable',
    artifact_source_candidate_run_id = null,
    worker_id = null,
    lease_token = null,
    lease_expires_at = null,
    unavailable_reason_codes = case
      when candidate.unavailable_reason_codes
        @> '["legacy_image_evidence_quarantined"]'::jsonb
        then candidate.unavailable_reason_codes
      else candidate.unavailable_reason_codes
        || '["legacy_image_evidence_quarantined"]'::jsonb
    end,
    public_failure_reason =
      'This underwriting result is unavailable because legacy image evidence '
      || 'was quarantined. Upload the image again and run analysis before '
      || 'relying on this result.'
from public.underwriting_batches as batch
join (
  select distinct workspace_id, run_id
  from quarantined_legacy_image_report_runs
) as polluted
  on polluted.workspace_id = batch.workspace_id
  and polluted.run_id = batch.scan_run_id
where candidate.workspace_id = batch.workspace_id
  and candidate.batch_id = batch.id;

update public.underwriting_batches as batch
set status = 'failed'
from (
  select distinct workspace_id, run_id
  from quarantined_legacy_image_report_runs
) as polluted
where batch.workspace_id = polluted.workspace_id
  and batch.scan_run_id = polluted.run_id;

-- Action drafts remain immutable audit artifacts, but an unavailable,
-- incomplete, failed, or alias candidate must not retain an editing surface.
-- Lock both identities so the candidate cannot become unavailable between the
-- authorization check and the controlled body-only update.
create or replace function public.replace_action_draft_body(
  p_workspace_id text,
  p_draft_id text,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.action_drafts%rowtype;
  next_payload jsonb;
begin
  if btrim(coalesce(p_workspace_id, '')) = ''
    or btrim(coalesce(p_draft_id, '')) = ''
  then
    raise exception 'A complete action draft identity is required';
  end if;
  if btrim(coalesce(p_body, '')) = ''
    or char_length(p_body) > 100000
  then
    raise exception
      'An action draft body must contain text and be at most 100000 characters';
  end if;

  select draft.*
  into target
  from public.action_drafts as draft
  join public.candidate_runs as candidate
    on candidate.workspace_id = draft.workspace_id
    and candidate.id = draft.candidate_run_id
  where draft.workspace_id = p_workspace_id
    and draft.artifact_id = p_draft_id
    and candidate.status = 'completed'
    and candidate.artifact_source_candidate_run_id is null
  for update of draft, candidate;

  if not found then
    return null;
  end if;
  if target.payload ->> 'id' <> target.artifact_id
    or target.payload ->> 'workspaceId' <> target.workspace_id
    or target.payload ->> 'candidateRunId' <> target.candidate_run_id
  then
    raise exception 'The persisted action draft identity is inconsistent';
  end if;

  next_payload := target.payload || jsonb_build_object(
    'body', p_body,
    'updatedAt',
    public.canonical_utc_iso_milliseconds(pg_catalog.clock_timestamp())
  );

  update public.action_drafts as draft
  set payload = next_payload
  where draft.workspace_id = target.workspace_id
    and draft.candidate_run_id = target.candidate_run_id
    and draft.artifact_id = target.artifact_id;

  return next_payload;
end;
$$;

alter function public.replace_action_draft_body(text, text, text)
  owner to vsee_underwriting_owner;

revoke all on function public.replace_action_draft_body(text, text, text)
  from public;

do $$
declare
  restricted_role text;
begin
  for restricted_role in
    select rolname
    from pg_catalog.pg_roles
    where rolname in ('anon', 'authenticated')
  loop
    execute pg_catalog.format(
      'revoke all on function public.replace_action_draft_body(text, text, text) from %I',
      restricted_role
    );
  end loop;

  if exists (
    select 1 from pg_catalog.pg_roles where rolname = 'service_role'
  ) then
    grant execute on function
      public.replace_action_draft_body(text, text, text)
      to service_role;
  end if;
end;
$$;

delete from public.intelligence_reports as report
using quarantined_legacy_image_report_runs as polluted
where report.workspace_id = polluted.workspace_id
  and report.id = polluted.report_id;

revoke create on schema public from vsee_registry_owner;
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
