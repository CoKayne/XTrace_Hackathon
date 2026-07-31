begin;

lock table public.uploaded_documents in access exclusive mode;

do $$
declare
  actual_columns text[];
  expected_columns constant text[] := array[
    'id:text:true',
    'workspace_id:text:true',
    'filename:text:true',
    'content_type:text:true',
    'byte_size:bigint:true',
    'checksum:text:true',
    'object_key:text:true',
    'status:text:true',
    'failure_reason:text:false',
    'company_name:text:false',
    'headline:text:false',
    'extracted_facts:jsonb:true',
    'memory_texts:jsonb:true',
    'memory_ids:jsonb:true',
    'xtrace_job_id:text:false',
    'deal_id:text:false',
    'lease_expires_at:timestamp with time zone:false',
    'worker_id:text:false',
    'created_at:timestamp with time zone:true',
    'updated_at:timestamp with time zone:true'
  ];
  status_definition text;
begin
  select array_agg(
    attribute.attname::text || ':'
      || pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
      || ':' || attribute.attnotnull::text
    order by attribute.attnum
  )
  into actual_columns
  from pg_catalog.pg_attribute as attribute
  where attribute.attrelid = 'public.uploaded_documents'::regclass
    and attribute.attnum > 0
    and not attribute.attisdropped;

  if actual_columns is distinct from expected_columns then
    raise exception
      'The uploaded_documents table is not the exact supported prototype shape';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid =
      'public.uploaded_documents'::regclass
      and constraint_record.contype = 'p'
      and pg_catalog.pg_get_constraintdef(constraint_record.oid)
        = 'PRIMARY KEY (id)'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid =
      'public.uploaded_documents'::regclass
      and constraint_record.contype = 'u'
      and pg_catalog.pg_get_constraintdef(constraint_record.oid)
        = 'UNIQUE (workspace_id, checksum)'
  ) then
    raise exception
      'The uploaded_documents prototype identity constraints are not supported';
  end if;

  select pg_catalog.pg_get_constraintdef(constraint_record.oid)
  into status_definition
  from pg_catalog.pg_constraint as constraint_record
  where constraint_record.conrelid = 'public.uploaded_documents'::regclass
    and constraint_record.conname = 'uploaded_documents_status_check'
    and constraint_record.contype = 'c';

  if status_definition is null
    or status_definition not like '%queued%'
    or status_definition not like '%extracting%'
    or status_definition not like '%ready%'
    or status_definition not like '%failed%'
    or status_definition like '%awaiting_confirmation%'
    or status_definition like '%confirmed%'
    or status_definition like '%ingesting_memory%'
  then
    raise exception
      'The uploaded_documents prototype status constraint is not supported';
  end if;

  if exists (
    select 1
    from public.uploaded_documents as upload
    where upload.status not in ('queued', 'failed')
      or upload.lease_expires_at is not null
      or (
        upload.status = 'queued'
        and upload.worker_id is not null
      )
  ) then
    raise exception
      'Prototype uploads include an active or semantically ambiguous state';
  end if;

  if exists (
    select 1
    from public.uploaded_documents as upload
    where upload.company_name is not null
      or upload.headline is not null
      or upload.xtrace_job_id is not null
      or upload.deal_id is not null
      or pg_catalog.jsonb_typeof(upload.extracted_facts) <> 'array'
      or pg_catalog.jsonb_typeof(upload.memory_texts) <> 'array'
      or pg_catalog.jsonb_typeof(upload.memory_ids) <> 'array'
      or pg_catalog.jsonb_array_length(upload.extracted_facts) <> 0
      or pg_catalog.jsonb_array_length(upload.memory_texts) <> 0
      or pg_catalog.jsonb_array_length(upload.memory_ids) <> 0
  ) then
    raise exception
      'Prototype uploads contain meaningful legacy payload requiring manual migration';
  end if;

  if not (
    select relation.relrowsecurity
    from pg_catalog.pg_class as relation
    where relation.oid = 'public.uploaded_documents'::regclass
  ) then
    raise exception
      'The uploaded_documents prototype is missing its RLS boundary';
  end if;
end;
$$;

alter table public.uploaded_documents
  add column extraction_preview jsonb;

alter table public.uploaded_documents
  drop constraint uploaded_documents_status_check;

alter table public.uploaded_documents
  add constraint uploaded_documents_status_check
  check (
    status in (
      'queued', 'extracting', 'awaiting_confirmation', 'confirmed',
      'ingesting_memory', 'ready', 'failed'
    )
  );

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = 'public.uploaded_documents'::regclass
      and attribute.attname = 'extraction_preview'
      and not attribute.attisdropped
  ) or not exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = 'public.uploaded_documents'::regclass
      and attribute.attname = 'memory_texts'
      and not attribute.attisdropped
  ) then
    raise exception
      'The uploaded_documents compatibility bridge postcondition failed';
  end if;
end;
$$;

commit;

notify pgrst, 'reload schema';
