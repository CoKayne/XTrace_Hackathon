begin;

alter table public.uploaded_documents
  add column if not exists lease_token uuid,
  add column if not exists deal_id text,
  add column if not exists source_id text,
  add column if not exists source_revision_id text,
  add column if not exists confirmation_fingerprint text;

-- An upgrade may catch an extractor whose pre-0013 claim has no capability
-- token. Return only that incomplete lease to its target-safe queue.
update public.uploaded_documents
set status = 'queued',
    worker_id = null,
    lease_token = null,
    lease_expires_at = null,
    updated_at = clock_timestamp()
where status = 'extracting'
  and worker_id is not null
  and lease_token is null;

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
  alter column source_id set not null,
  drop constraint if exists source_evidence_items_payload_identity_check;
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
      and evidence_excerpt <> ''
      and structured_category is not null
      and (
        (
          structured_category = 'currency'
          and normalized_unit = 'currency'
          and structured_currency = 'USD'
          and structured_value ~
            '^([+-]?[$]?(([0-9]{1,3}(,[0-9]{3})+|[0-9]+)([.][0-9]*)?|[.][0-9]+)([[:space:]]*USD)?|[(][$]?(([0-9]{1,3}(,[0-9]{3})+|[0-9]+)([.][0-9]*)?|[.][0-9]+)([[:space:]]*USD)?[)])$'
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
    if structured_complete then
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
grant select, insert on public.source_evidence_items to vsee_registry_owner;

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
create policy source_evidence_items_upload_registry_owner
  on public.source_evidence_items for all to vsee_registry_owner
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

commit;

notify pgrst, 'reload schema';
