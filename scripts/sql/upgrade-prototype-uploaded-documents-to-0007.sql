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
  prototype_relation oid := 'public.uploaded_documents'::regclass;
  prototype_owner oid;
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

  if exists (
    select 1
    from (
      values
        ('status', '''queued''::text'),
        ('extracted_facts', '''[]''::jsonb'),
        ('memory_texts', '''[]''::jsonb'),
        ('memory_ids', '''[]''::jsonb'),
        ('created_at', 'now()'),
        ('updated_at', 'now()')
    ) as expected(attname, expression)
    left join pg_catalog.pg_attribute as attribute
      on attribute.attrelid = prototype_relation
      and attribute.attname = expected.attname
      and not attribute.attisdropped
    left join pg_catalog.pg_attrdef as default_record
      on default_record.adrelid = attribute.attrelid
      and default_record.adnum = attribute.attnum
    where pg_catalog.pg_get_expr(
      default_record.adbin,
      default_record.adrelid
    ) is distinct from expected.expression
  ) or exists (
    select 1
    from pg_catalog.pg_attrdef as default_record
    join pg_catalog.pg_attribute as attribute
      on attribute.attrelid = default_record.adrelid
      and attribute.attnum = default_record.adnum
    where default_record.adrelid = prototype_relation
      and attribute.attname not in (
        'status', 'extracted_facts', 'memory_texts', 'memory_ids',
        'created_at', 'updated_at'
      )
  ) then
    raise exception
      'The uploaded_documents prototype defaults are not supported';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_constraint
    where conrelid = prototype_relation
  ) <> 5
  or not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = prototype_relation
      and constraint_record.contype = 'p'
      and pg_catalog.pg_get_constraintdef(constraint_record.oid)
        = 'PRIMARY KEY (id)'
  )
  or not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = prototype_relation
      and constraint_record.contype = 'u'
      and pg_catalog.pg_get_constraintdef(constraint_record.oid)
        = 'UNIQUE (workspace_id, checksum)'
  )
  or not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = prototype_relation
      and constraint_record.contype = 'f'
      and pg_catalog.pg_get_constraintdef(constraint_record.oid)
        = 'FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE'
  )
  or not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = prototype_relation
      and constraint_record.contype = 'c'
      and pg_catalog.pg_get_constraintdef(constraint_record.oid)
        = 'CHECK ((byte_size > 0))'
  )
  or not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = prototype_relation
      and constraint_record.contype = 'c'
      and constraint_record.conname = 'uploaded_documents_status_check'
      and pg_catalog.pg_get_constraintdef(constraint_record.oid)
        = 'CHECK ((status = ANY (ARRAY['
          || '''queued''::text, ''extracting''::text, ''ready''::text, '
          || '''failed''::text])))'
  )
  then
    raise exception
      'The uploaded_documents prototype constraints are not supported';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_index as index_record
    left join pg_catalog.pg_constraint as constraint_record
      on constraint_record.conindid = index_record.indexrelid
    where index_record.indrelid = prototype_relation
      and constraint_record.oid is null
  ) <> 2
  or not exists (
    select 1
    from pg_catalog.pg_index as index_record
    join pg_catalog.pg_class as index_relation
      on index_relation.oid = index_record.indexrelid
    left join pg_catalog.pg_constraint as constraint_record
      on constraint_record.conindid = index_record.indexrelid
    where index_record.indrelid = prototype_relation
      and constraint_record.oid is null
      and index_relation.relname = 'uploaded_documents_claimable'
      and not index_record.indisunique
      and index_record.indpred is null
      and pg_catalog.pg_get_indexdef(index_record.indexrelid)
        = 'CREATE INDEX uploaded_documents_claimable ON '
          || 'public.uploaded_documents USING btree '
          || '(status, lease_expires_at)'
  )
  or not exists (
    select 1
    from pg_catalog.pg_index as index_record
    join pg_catalog.pg_class as index_relation
      on index_relation.oid = index_record.indexrelid
    left join pg_catalog.pg_constraint as constraint_record
      on constraint_record.conindid = index_record.indexrelid
    where index_record.indrelid = prototype_relation
      and constraint_record.oid is null
      and index_relation.relname = 'uploaded_documents_workspace_created'
      and not index_record.indisunique
      and index_record.indpred is null
      and pg_catalog.pg_get_indexdef(index_record.indexrelid)
        = 'CREATE INDEX uploaded_documents_workspace_created ON '
          || 'public.uploaded_documents USING btree '
          || '(workspace_id, created_at DESC)'
  ) then
    raise exception
      'The uploaded_documents prototype indexes are not supported';
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

  select relation.relowner
  into prototype_owner
  from pg_catalog.pg_class as relation
  where relation.oid = prototype_relation;

  if not (
    select relation.relrowsecurity and not relation.relforcerowsecurity
    from pg_catalog.pg_class as relation
    where relation.oid = prototype_relation
  )
  or exists (
    select 1
    from pg_catalog.pg_policy
    where polrelid = prototype_relation
  )
  or exists (
    select 1
    from pg_catalog.pg_trigger
    where tgrelid = prototype_relation
      and not tgisinternal
  )
  or exists (
    select 1
    from pg_catalog.aclexplode(
      coalesce(
        (
          select relation.relacl
          from pg_catalog.pg_class as relation
          where relation.oid = prototype_relation
        ),
        pg_catalog.acldefault('r', prototype_owner)
      )
    ) as privilege
    where privilege.grantee <> prototype_owner
      and not (
        privilege.grantee = (
          select oid from pg_catalog.pg_roles
          where rolname = 'service_role'
        )
        and privilege.grantor = prototype_owner
        and not privilege.is_grantable
        and privilege.privilege_type in (
          'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
          'REFERENCES', 'TRIGGER', 'MAINTAIN'
        )
      )
  )
  or exists (
    select 1
    from pg_catalog.pg_roles as role_record
    where role_record.rolname in ('anon', 'authenticated')
      and pg_catalog.has_table_privilege(
        role_record.oid,
        prototype_relation,
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
      )
  )
  or (
    exists (
      select 1
      from pg_catalog.pg_roles
      where rolname = 'service_role'
    )
    and exists (
      select 1
      from (
        values
          ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
          ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')
      ) as required(privilege_name)
      where not pg_catalog.has_table_privilege(
        (
          select oid from pg_catalog.pg_roles
          where rolname = 'service_role'
        ),
        prototype_relation,
        required.privilege_name
      )
    )
  ) then
    raise exception
      'The uploaded_documents prototype access boundary is not supported';
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
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid =
      'public.uploaded_documents'::regclass
      and constraint_record.conname = 'uploaded_documents_status_check'
      and constraint_record.contype = 'c'
      and pg_catalog.pg_get_constraintdef(constraint_record.oid)
        = 'CHECK ((status = ANY (ARRAY['
          || '''queued''::text, ''extracting''::text, '
          || '''awaiting_confirmation''::text, ''confirmed''::text, '
          || '''ingesting_memory''::text, ''ready''::text, '
          || '''failed''::text])))'
  ) or exists (
    select 1
    from public.uploaded_documents as upload
    where upload.status not in ('queued', 'failed')
      or upload.lease_expires_at is not null
      or (upload.status = 'queued' and upload.worker_id is not null)
      or upload.company_name is not null
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
      'The uploaded_documents compatibility bridge postcondition failed';
  end if;
end;
$$;

commit;

notify pgrst, 'reload schema';
