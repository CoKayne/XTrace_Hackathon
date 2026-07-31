#!/bin/zsh
set -euo pipefail

script_directory="${0:A:h}"
repository_root="${script_directory:h}"
libpq_service_renderer="${script_directory}/render-private-libpq-service.mjs"
bridge_file="${script_directory}/sql/upgrade-prototype-uploaded-documents-to-0007.sql"
migration_0008="${repository_root}/drizzle/0008_workspace_composite_identity.sql"
migration_0009="${repository_root}/drizzle/0009_source_revision_deal_registry.sql"

for required_file in \
  "$libpq_service_renderer" \
  "$bridge_file" \
  "$migration_0008" \
  "$migration_0009"; do
  if [[ ! -f "$required_file" ]]; then
    print -u2 "Required baseline migration file is missing: ${required_file:t}"
    exit 1
  fi
done

if ! DATABASE_URL="$(security find-generic-password -a "$USER" -s "vsee-supabase-db-url" -w)"; then
  print -u2 "Required Keychain service unavailable: vsee-supabase-db-url"
  exit 1
fi

if [[ -z "$DATABASE_URL" ]]; then
  print -u2 "Required Keychain service is empty: vsee-supabase-db-url"
  exit 1
fi

if [[ "$DATABASE_URL" == *$'\n'* || "$DATABASE_URL" == *$'\r'* ]]; then
  print -u2 "Required Keychain service is not a valid single-line connection URI."
  exit 1
fi

libpq_service_directory="$(
  mktemp -d "${TMPDIR:-/tmp}/vsee-production-libpq.XXXXXXXX"
)"
libpq_service_file="${libpq_service_directory}/pg_service.conf"
libpq_password_file="${libpq_service_directory}/pgpass"

cleanup_libpq_service() {
  command rm -f -- "$libpq_service_file" "$libpq_password_file"
  command rmdir -- "$libpq_service_directory" 2>/dev/null || true
}
trap cleanup_libpq_service EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

chmod 700 "$libpq_service_directory"
typeset +x DATABASE_URL
if ! print -rn -- "$DATABASE_URL" \
  | node "$libpq_service_renderer" "$libpq_service_file" "$libpq_password_file"; then
  unset DATABASE_URL
  print -u2 "Could not prepare the private database connection configuration."
  exit 1
fi
unset DATABASE_URL
export PGSERVICEFILE="$libpq_service_file"
export PGSERVICE="vsee-production"
export PGPASSFILE="$libpq_password_file"

baseline_state_sql() {
  case "$1" in
    0007)
      cat <<'SQL'
-- vsee-baseline-state: 0007
with prerequisite_markers(value) as (
  values
    (to_regclass('public.workspaces') is not null),
    (to_regclass('public.scan_runs') is not null),
    (to_regclass('public.scan_run_steps') is not null),
    (to_regclass('public.companies') is not null),
    (to_regclass('public.deals') is not null),
    (to_regclass('public.source_evidence') is not null),
    (to_regclass('public.deal_interactions') is not null),
    (to_regclass('public.intelligence_reports') is not null),
    (to_regclass('public.company_analyses') is not null),
    (to_regclass('public.xtrace_ingest_jobs') is not null),
    (to_regclass('public.xtrace_memory_links') is not null),
    (to_regclass('public.reasoner_judgments') is not null),
    (to_regclass('public.uploaded_documents') is not null),
    (to_regprocedure(
      'public.save_intelligence_report(jsonb,jsonb)'
    ) is not null),
    (to_regprocedure(
      'public.take_public_request(text,text,integer,integer)'
    ) is not null),
    (to_regprocedure('public.claim_next_scan_run(text)') is not null),
    (exists (
      select 1
      from pg_catalog.pg_extension
      where extname = 'pgcrypto'
    )),
    (exists (
      select 1
      from pg_catalog.pg_constraint
      where conrelid = to_regclass('public.workspaces')
        and contype = 'p'
        and pg_catalog.pg_get_constraintdef(oid) = 'PRIMARY KEY (id)'
    )),
    (exists (
      select 1
      from pg_catalog.pg_constraint
      where conrelid = to_regclass('public.scan_runs')
        and contype = 'p'
        and pg_catalog.pg_get_constraintdef(oid) = 'PRIMARY KEY (id)'
    )),
    (exists (
      select 1
      from pg_catalog.pg_constraint
      where conrelid = to_regclass('public.scan_runs')
        and contype = 'f'
        and pg_catalog.pg_get_constraintdef(oid)
          = 'FOREIGN KEY (workspace_id) REFERENCES workspaces(id)'
    )),
    (exists (
      select 1
      from pg_catalog.pg_constraint
      where conrelid = to_regclass('public.scan_run_steps')
        and contype = 'p'
        and pg_catalog.pg_get_constraintdef(oid) = 'PRIMARY KEY (id)'
    )),
    (exists (
      select 1
      from pg_catalog.pg_attribute
      where attrelid = to_regclass('public.deal_interactions')
        and attname = 'decision_reason'
        and attnotnull
        and not attisdropped
    )),
    (exists (
      select 1
      from pg_catalog.pg_attribute
      where attrelid = to_regclass('public.xtrace_ingest_jobs')
        and attname = 'bundle_fingerprint'
        and attnotnull
        and not attisdropped
    )),
    (exists (
      select 1
      from pg_catalog.pg_attribute
      where attrelid = to_regclass('public.xtrace_ingest_jobs')
        and attname = 'serializer_version'
        and attnotnull
        and not attisdropped
    )),
    (not exists (
      select 1
      from pg_catalog.pg_attribute
      where attrelid = to_regclass('public.intelligence_reports')
        and attname = 'delivery'
        and not attisdropped
    )),
    (exists (
      select 1
      from pg_catalog.pg_constraint
      where conrelid = to_regclass('public.deal_interactions')
        and conname = 'deal_interactions_demo_fixture_label_check'
        and pg_catalog.pg_get_constraintdef(oid)
          = 'CHECK ((label = ''Sample decision record''::text))'
    )),
    (exists (
      select 1
      from pg_catalog.pg_proc as procedure_record
      join pg_catalog.pg_language as language_record
        on language_record.oid = procedure_record.prolang
      where procedure_record.oid =
        to_regprocedure('public.claim_next_scan_run(text)')
        and language_record.lanname = 'plpgsql'
        and procedure_record.prosecdef
        and procedure_record.proconfig
          = array['search_path=pg_catalog, pg_temp']::text[]
    )),
    (exists (
      select 1
      from pg_catalog.pg_proc as procedure_record
      join pg_catalog.pg_language as language_record
        on language_record.oid = procedure_record.prolang
      where procedure_record.oid = to_regprocedure(
        'public.take_public_request(text,text,integer,integer)'
      )
        and language_record.lanname = 'plpgsql'
        and procedure_record.prosecdef
        and procedure_record.proconfig
          = array['search_path=pg_catalog, pg_temp']::text[]
    ))
), prerequisite as (
  select
    coalesce(pg_catalog.bool_and(value), false) as complete
  from prerequisite_markers
), upload_columns as (
  select
    array_agg(
      attribute.attname::text || ':'
        || pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
        || ':' || attribute.attnotnull::text
      order by attribute.attnum
    ) as columns
  from pg_catalog.pg_attribute as attribute
  where attribute.attrelid = to_regclass('public.uploaded_documents')
    and attribute.attnum > 0
    and not attribute.attisdropped
), upload_shape as (
  select
    upload_columns.columns,
    relation.relrowsecurity,
    relation.relforcerowsecurity,
    relation.relowner
  from upload_columns
  join pg_catalog.pg_class as relation
    on relation.oid = to_regclass('public.uploaded_documents')
), upload_defaults as (
  select
    not exists (
      select 1
      from (
        values
          ('status', '''queued''::text'),
          ('created_at', 'now()'),
          ('updated_at', 'now()')
      ) as expected(attname, expression)
      left join pg_catalog.pg_attribute as attribute
        on attribute.attrelid = to_regclass('public.uploaded_documents')
        and attribute.attname = expected.attname
        and not attribute.attisdropped
      left join pg_catalog.pg_attrdef as default_record
        on default_record.adrelid = attribute.attrelid
        and default_record.adnum = attribute.attnum
      where pg_catalog.pg_get_expr(
        default_record.adbin,
        default_record.adrelid
      ) is distinct from expected.expression
    ) as common_exact,
    not exists (
      select 1
      from (
        values
          ('extracted_facts', '''[]''::jsonb'),
          ('memory_texts', '''[]''::jsonb'),
          ('memory_ids', '''[]''::jsonb')
      ) as expected(attname, expression)
      left join pg_catalog.pg_attribute as attribute
        on attribute.attrelid = to_regclass('public.uploaded_documents')
        and attribute.attname = expected.attname
        and not attribute.attisdropped
      left join pg_catalog.pg_attrdef as default_record
        on default_record.adrelid = attribute.attrelid
        and default_record.adnum = attribute.attnum
      where pg_catalog.pg_get_expr(
        default_record.adbin,
        default_record.adrelid
      ) is distinct from expected.expression
    ) as legacy_exact
), upload_catalog as (
  select
    exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = to_regclass('public.uploaded_documents')
        and contype = 'c'
        and pg_catalog.pg_get_constraintdef(oid)
          = 'CHECK ((byte_size > 0))'
    ) as byte_size_exact,
    exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = to_regclass('public.uploaded_documents')
        and contype = 'f'
        and pg_catalog.pg_get_constraintdef(oid)
          = 'FOREIGN KEY (workspace_id) REFERENCES '
            || 'workspaces(id) ON DELETE CASCADE'
    ) as workspace_fk_exact,
    exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = to_regclass('public.uploaded_documents')
        and contype = 'u'
        and pg_catalog.pg_get_constraintdef(oid)
          = 'UNIQUE (workspace_id, checksum)'
    ) as workspace_checksum_exact,
    exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = to_regclass('public.uploaded_documents')
        and contype = 'p'
        and pg_catalog.pg_get_constraintdef(oid) = 'PRIMARY KEY (id)'
    ) as scalar_primary_key,
    exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = to_regclass('public.uploaded_documents')
        and contype = 'p'
        and pg_catalog.pg_get_constraintdef(oid)
          = 'PRIMARY KEY (workspace_id, id)'
    ) as composite_primary_key,
    exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = to_regclass('public.uploaded_documents')
        and conname = 'uploaded_documents_status_check'
        and contype = 'c'
        and pg_catalog.pg_get_constraintdef(oid)
          = 'CHECK ((status = ANY (ARRAY['
            || '''queued''::text, ''extracting''::text, '
            || '''ready''::text, ''failed''::text])))'
    ) as prototype_status_exact,
    exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = to_regclass('public.uploaded_documents')
        and conname = 'uploaded_documents_status_check'
        and contype = 'c'
        and pg_catalog.pg_get_constraintdef(oid)
          = 'CHECK ((status = ANY (ARRAY['
            || '''queued''::text, ''extracting''::text, '
            || '''awaiting_confirmation''::text, ''confirmed''::text, '
            || '''ingesting_memory''::text, ''ready''::text, '
            || '''failed''::text])))'
    ) as current_status_exact,
    exists (
      select 1
      from pg_catalog.pg_index as index_record
      join pg_catalog.pg_class as index_relation
        on index_relation.oid = index_record.indexrelid
      where index_record.indrelid =
        to_regclass('public.uploaded_documents')
        and index_relation.relname = 'uploaded_documents_claimable'
        and not index_record.indisunique
        and index_record.indpred is null
        and pg_catalog.pg_get_indexdef(index_record.indexrelid)
          = 'CREATE INDEX uploaded_documents_claimable ON '
            || 'public.uploaded_documents USING btree '
            || '(status, lease_expires_at)'
    ) as claimable_index_exact,
    exists (
      select 1
      from pg_catalog.pg_index as index_record
      join pg_catalog.pg_class as index_relation
        on index_relation.oid = index_record.indexrelid
      where index_record.indrelid =
        to_regclass('public.uploaded_documents')
        and index_relation.relname =
          'uploaded_documents_workspace_created'
        and not index_record.indisunique
        and index_record.indpred is null
        and pg_catalog.pg_get_indexdef(index_record.indexrelid)
          = 'CREATE INDEX uploaded_documents_workspace_created ON '
            || 'public.uploaded_documents USING btree '
            || '(workspace_id, created_at DESC)'
    ) as workspace_created_index_exact
), upload_access as (
  select
    upload_shape.relrowsecurity
      and not upload_shape.relforcerowsecurity
      and not exists (
        select 1
        from pg_catalog.aclexplode(
          coalesce(
            (
              select relation.relacl
              from pg_catalog.pg_class as relation
              where relation.oid =
                to_regclass('public.uploaded_documents')
            ),
            pg_catalog.acldefault('r', upload_shape.relowner)
          )
        ) as privilege
        where privilege.grantee <> upload_shape.relowner
          and not exists (
            select 1
            from pg_catalog.pg_roles as role_record
            where role_record.rolname in (
              'service_role', 'vsee_registry_owner'
            )
              and role_record.oid = privilege.grantee
          )
      )
      and not exists (
        select 1
        from pg_catalog.pg_roles as role_record
        where role_record.rolname in ('anon', 'authenticated')
          and pg_catalog.has_table_privilege(
            role_record.oid,
            to_regclass('public.uploaded_documents'),
            'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
          )
      )
      as boundary_exact,
    not exists (
      select 1
      from pg_catalog.aclexplode(
        coalesce(
          (
            select relation.relacl
            from pg_catalog.pg_class as relation
            where relation.oid =
              to_regclass('public.uploaded_documents')
          ),
          pg_catalog.acldefault('r', upload_shape.relowner)
        )
      ) as privilege
      where privilege.grantee <> upload_shape.relowner
        and not exists (
          select 1
          from pg_catalog.pg_roles as role_record
          where role_record.rolname = 'service_role'
            and role_record.oid = privilege.grantee
        )
    )
      and (
        not exists (
          select 1 from pg_catalog.pg_roles
          where rolname = 'service_role'
        )
        or pg_catalog.has_table_privilege(
          (
            select oid from pg_catalog.pg_roles
            where rolname = 'service_role'
          ),
          to_regclass('public.uploaded_documents'),
          'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
        )
      ) as prototype_exact
  from upload_shape
), upload_safety as (
  select not exists (
    select 1
    from public.uploaded_documents as upload
    where upload.status not in ('queued', 'failed')
      or upload.lease_expires_at is not null
      or (
        upload.status = 'queued'
        and upload.worker_id is not null
      )
      or (pg_catalog.to_jsonb(upload) ->> 'company_name') is not null
      or (pg_catalog.to_jsonb(upload) ->> 'headline') is not null
      or (pg_catalog.to_jsonb(upload) ->> 'xtrace_job_id') is not null
      or (pg_catalog.to_jsonb(upload) ->> 'deal_id') is not null
      or case
        when pg_catalog.jsonb_typeof(
          pg_catalog.to_jsonb(upload) -> 'extracted_facts'
        ) = 'array'
        then pg_catalog.jsonb_array_length(
          pg_catalog.to_jsonb(upload) -> 'extracted_facts'
        ) <> 0
        else (pg_catalog.to_jsonb(upload) ? 'extracted_facts')
      end
      or case
        when pg_catalog.jsonb_typeof(
          pg_catalog.to_jsonb(upload) -> 'memory_texts'
        ) = 'array'
        then pg_catalog.jsonb_array_length(
          pg_catalog.to_jsonb(upload) -> 'memory_texts'
        ) <> 0
        else (pg_catalog.to_jsonb(upload) ? 'memory_texts')
      end
      or case
        when pg_catalog.jsonb_typeof(
          pg_catalog.to_jsonb(upload) -> 'memory_ids'
        ) = 'array'
        then pg_catalog.jsonb_array_length(
          pg_catalog.to_jsonb(upload) -> 'memory_ids'
        ) <> 0
        else (pg_catalog.to_jsonb(upload) ? 'memory_ids')
      end
  ) as safe
), classified as (
  select
    prerequisite.complete as prerequisite_complete,
    upload_shape.columns,
    upload_defaults.common_exact,
    upload_defaults.legacy_exact,
    upload_catalog.*,
    upload_access.boundary_exact as access_exact,
    upload_access.prototype_exact as prototype_access_exact,
    upload_safety.safe
  from prerequisite
  cross join upload_shape
  cross join upload_defaults
  cross join upload_catalog
  cross join upload_access
  cross join upload_safety
)
select case
  when not prerequisite_complete then 'partial'
  when columns = array[
    'id:text:true',
    'workspace_id:text:true',
    'filename:text:true',
    'content_type:text:true',
    'byte_size:bigint:true',
    'checksum:text:true',
    'object_key:text:true',
    'status:text:true',
    'failure_reason:text:false',
    'extraction_preview:jsonb:false',
    'lease_expires_at:timestamp with time zone:false',
    'worker_id:text:false',
    'created_at:timestamp with time zone:true',
    'updated_at:timestamp with time zone:true'
  ]::text[]
    and common_exact
    and current_status_exact
    and byte_size_exact
    and workspace_fk_exact
    and workspace_checksum_exact
    and (scalar_primary_key or composite_primary_key)
    and claimable_index_exact
    and workspace_created_index_exact
    and access_exact
  then 'complete'
  when columns = array[
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
  ]::text[]
    and common_exact
    and legacy_exact
    and prototype_status_exact
    and byte_size_exact
    and workspace_fk_exact
    and workspace_checksum_exact
    and scalar_primary_key
    and claimable_index_exact
    and workspace_created_index_exact
    and access_exact
    and prototype_access_exact
    and (
      select count(*) = 5
      from pg_catalog.pg_constraint
      where conrelid = to_regclass('public.uploaded_documents')
    )
    and (
      select count(*) = 2
      from pg_catalog.pg_index as index_record
      left join pg_catalog.pg_constraint as constraint_record
        on constraint_record.conindid = index_record.indexrelid
      where index_record.indrelid =
        to_regclass('public.uploaded_documents')
        and constraint_record.oid is null
    )
    and not exists (
      select 1 from pg_catalog.pg_policy
      where polrelid = to_regclass('public.uploaded_documents')
    )
    and not exists (
      select 1 from pg_catalog.pg_trigger
      where tgrelid = to_regclass('public.uploaded_documents')
        and not tgisinternal
    )
  then case when safe then 'prototype_safe' else 'prototype_unsafe' end
  when columns = array[
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
    'updated_at:timestamp with time zone:true',
    'extraction_preview:jsonb:false'
  ]::text[]
    and common_exact
    and legacy_exact
    and current_status_exact
    and byte_size_exact
    and workspace_fk_exact
    and workspace_checksum_exact
    and (scalar_primary_key or composite_primary_key)
    and claimable_index_exact
    and workspace_created_index_exact
    and access_exact
  then case when safe then 'bridged_safe' else 'bridged_unsafe' end
  when columns @> array[
    'id:text:true',
    'workspace_id:text:true',
    'filename:text:true',
    'content_type:text:true',
    'byte_size:bigint:true',
    'checksum:text:true',
    'object_key:text:true',
    'status:text:true',
    'failure_reason:text:false',
    'extraction_preview:jsonb:false',
    'lease_expires_at:timestamp with time zone:false',
    'worker_id:text:false',
    'created_at:timestamp with time zone:true',
    'updated_at:timestamp with time zone:true'
  ]::text[]
    and not columns && array[
      'company_name:text:false',
      'headline:text:false',
      'extracted_facts:jsonb:true',
      'memory_texts:jsonb:true',
      'memory_ids:jsonb:true',
      'xtrace_job_id:text:false'
    ]::text[]
    and common_exact
    and current_status_exact
    and byte_size_exact
    and workspace_fk_exact
    and workspace_checksum_exact
    and (scalar_primary_key or composite_primary_key)
    and claimable_index_exact
    and workspace_created_index_exact
    and access_exact
  then 'complete'
  when columns @> array[
    'company_name:text:false',
    'headline:text:false',
    'extracted_facts:jsonb:true',
    'memory_texts:jsonb:true',
    'memory_ids:jsonb:true',
    'xtrace_job_id:text:false',
    'deal_id:text:false',
    'extraction_preview:jsonb:false'
  ]::text[]
    and common_exact
    and legacy_exact
    and current_status_exact
    and byte_size_exact
    and workspace_fk_exact
    and workspace_checksum_exact
    and (scalar_primary_key or composite_primary_key)
    and claimable_index_exact
    and workspace_created_index_exact
    and access_exact
  then case when safe then 'bridged_safe' else 'bridged_unsafe' end
  else 'partial'
end
from classified;
SQL
      ;;
    0008)
      cat <<'SQL'
-- vsee-baseline-state: 0008
with expected_constraints(relation_name, constraint_name, constraint_type, definition) as (
  values
    ('companies', 'companies_pkey', 'p',
      'PRIMARY KEY (workspace_id, id)'),
    ('deals', 'deals_pkey', 'p',
      'PRIMARY KEY (workspace_id, id)'),
    ('source_evidence', 'source_evidence_pkey', 'p',
      'PRIMARY KEY (workspace_id, id)'),
    ('deal_interactions', 'deal_interactions_pkey', 'p',
      'PRIMARY KEY (workspace_id, id)'),
    ('intelligence_reports', 'intelligence_reports_pkey', 'p',
      'PRIMARY KEY (workspace_id, id)'),
    ('company_analyses', 'company_analyses_pkey', 'p',
      'PRIMARY KEY (workspace_id, id)'),
    ('xtrace_ingest_jobs', 'xtrace_ingest_jobs_pkey', 'p',
      'PRIMARY KEY (workspace_id, job_id)'),
    ('xtrace_memory_links', 'xtrace_memory_links_pkey', 'p',
      'PRIMARY KEY (workspace_id, memory_id)'),
    ('uploaded_documents', 'uploaded_documents_pkey', 'p',
      'PRIMARY KEY (workspace_id, id)'),
    ('scan_runs', 'scan_runs_workspace_id_id_unique', 'u',
      'UNIQUE (workspace_id, id)'),
    ('scan_run_steps', 'scan_run_steps_workspace_run_fkey', 'f',
      'FOREIGN KEY (workspace_id, run_id) '
        || 'REFERENCES scan_runs(workspace_id, id) ON DELETE CASCADE'),
    ('deals', 'deals_workspace_company_fkey', 'f',
      'FOREIGN KEY (workspace_id, company_id) '
        || 'REFERENCES companies(workspace_id, id) ON DELETE CASCADE'),
    ('source_evidence', 'source_evidence_workspace_deal_fkey', 'f',
      'FOREIGN KEY (workspace_id, deal_id) '
        || 'REFERENCES deals(workspace_id, id) ON DELETE CASCADE'),
    ('deal_interactions', 'deal_interactions_workspace_deal_fkey', 'f',
      'FOREIGN KEY (workspace_id, deal_id) '
        || 'REFERENCES deals(workspace_id, id) ON DELETE CASCADE'),
    ('intelligence_reports', 'intelligence_reports_workspace_run_fkey', 'f',
      'FOREIGN KEY (workspace_id, run_id) '
        || 'REFERENCES scan_runs(workspace_id, id) ON DELETE CASCADE'),
    ('company_analyses', 'company_analyses_workspace_report_fkey', 'f',
      'FOREIGN KEY (workspace_id, report_id) '
        || 'REFERENCES intelligence_reports(workspace_id, id) '
        || 'ON DELETE CASCADE'),
    ('company_analyses', 'company_analyses_workspace_run_fkey', 'f',
      'FOREIGN KEY (workspace_id, run_id) '
        || 'REFERENCES scan_runs(workspace_id, id) ON DELETE CASCADE'),
    ('company_analyses', 'company_analyses_workspace_deal_fkey', 'f',
      'FOREIGN KEY (workspace_id, deal_id) '
        || 'REFERENCES deals(workspace_id, id) ON DELETE CASCADE'),
    ('company_analyses',
      'company_analyses_workspace_report_deal_unique', 'u',
      'UNIQUE (workspace_id, report_id, deal_id)'),
    ('xtrace_ingest_jobs', 'xtrace_ingest_jobs_workspace_deal_fkey', 'f',
      'FOREIGN KEY (workspace_id, deal_id) '
        || 'REFERENCES deals(workspace_id, id) ON DELETE CASCADE'),
    ('xtrace_memory_links', 'xtrace_memory_links_workspace_deal_fkey', 'f',
      'FOREIGN KEY (workspace_id, deal_id) '
        || 'REFERENCES deals(workspace_id, id) ON DELETE CASCADE')
), introduced_names(relation_name, constraint_name) as (
  select relation_name, constraint_name
  from expected_constraints
  where constraint_type <> 'p'
), exact_catalog as (
  select
    exists (
      select 1
      from pg_catalog.pg_attribute
      where attrelid = to_regclass('public.scan_run_steps')
        and attname = 'workspace_id'
        and attnotnull
        and not attisdropped
    )
    and not exists (
      select 1
      from expected_constraints as expected
      left join pg_catalog.pg_constraint as actual
        on actual.conrelid = to_regclass(
          'public.' || expected.relation_name
        )
        and actual.conname = expected.constraint_name
        and actual.contype = expected.constraint_type::"char"
        and pg_catalog.pg_get_constraintdef(actual.oid)
          = expected.definition
      where actual.oid is null
    )
    and not exists (
      select 1
      from pg_catalog.pg_constraint
      where conname in (
        'scan_run_steps_run_id_fkey',
        'deals_company_id_fkey',
        'source_evidence_deal_id_fkey',
        'deal_interactions_deal_id_fkey',
        'intelligence_reports_run_id_fkey',
        'company_analyses_report_id_fkey',
        'company_analyses_run_id_fkey',
        'company_analyses_deal_id_fkey',
        'company_analyses_report_id_deal_id_key',
        'company_analyses_report_deal_unique',
        'xtrace_ingest_jobs_deal_id_fkey',
        'xtrace_memory_links_deal_id_fkey'
      )
    )
    and exists (
      select 1
      from pg_catalog.pg_proc as procedure_record
      join pg_catalog.pg_language as language_record
        on language_record.oid = procedure_record.prolang
      where procedure_record.oid = coalesce(
        to_regprocedure(
          'public.save_intelligence_report_legacy_0009(jsonb,jsonb)'
        ),
        to_regprocedure('public.save_intelligence_report(jsonb,jsonb)')
      )
        and language_record.lanname = 'plpgsql'
        and not procedure_record.prosecdef
        and procedure_record.proconfig
          = array['search_path=pg_catalog, public']::text[]
        and lower(pg_catalog.pg_get_functiondef(procedure_record.oid))
          like '%on conflict (workspace_id, id)%'
        and lower(pg_catalog.pg_get_functiondef(procedure_record.oid))
          like '%company_analysis.workspace_id = target_workspace_id%'
        and lower(pg_catalog.pg_get_functiondef(procedure_record.oid))
          like '%report.workspace_id = target_workspace_id%'
    ) as complete
), introduced_presence as (
  select
    exists (
      select 1
      from pg_catalog.pg_attribute
      where attrelid = to_regclass('public.scan_run_steps')
        and attname = 'workspace_id'
        and not attisdropped
    )
    or exists (
      select 1
      from introduced_names as introduced
      join pg_catalog.pg_constraint as actual
        on actual.conrelid = to_regclass(
          'public.' || introduced.relation_name
        )
        and actual.conname = introduced.constraint_name
    )
    or exists (
      select 1
      from pg_catalog.pg_constraint
      where conrelid in (
        to_regclass('public.companies'),
        to_regclass('public.deals'),
        to_regclass('public.source_evidence'),
        to_regclass('public.deal_interactions'),
        to_regclass('public.intelligence_reports'),
        to_regclass('public.company_analyses'),
        to_regclass('public.xtrace_ingest_jobs'),
        to_regclass('public.xtrace_memory_links'),
        to_regclass('public.uploaded_documents')
      )
        and contype = 'p'
        and pg_catalog.pg_get_constraintdef(oid)
          like 'PRIMARY KEY (workspace_id,%'
    ) as present
)
select case
  when (select complete from exact_catalog) then 'complete'
  when not (select present from introduced_presence) then 'absent'
  else 'partial'
end;
SQL
      ;;
    0009)
      cat <<'SQL'
-- vsee-baseline-state: 0009
with schema_presence(value) as (
  values
    (to_regclass('public.source_revisions') is not null),
    (to_regclass('public.source_revision_annotations') is not null),
    (to_regclass('public.deal_source_assignments') is not null),
    (exists (
      select 1 from pg_catalog.pg_attribute
      where attrelid = to_regclass('public.deals')
        and attname = 'status' and attnotnull and not attisdropped
    )),
    (exists (
      select 1 from pg_catalog.pg_attribute
      where attrelid = to_regclass('public.deals')
        and attname = 'analysis_eligible_at' and not attisdropped
    )),
    (exists (
      select 1 from pg_catalog.pg_attribute
      where attrelid = to_regclass('public.deals')
        and attname = 'active_source_revision_fingerprint'
        and not attisdropped
    )),
    (exists (
      select 1 from pg_catalog.pg_attribute
      where attrelid = to_regclass('public.source_evidence')
        and attname = 'source_revision_id' and not attisdropped
    )),
    (exists (
      select 1 from pg_catalog.pg_attribute
      where attrelid = to_regclass('public.deal_interactions')
        and attname = 'source_revision_id' and not attisdropped
    )),
    (exists (
      select 1 from pg_catalog.pg_attribute
      where attrelid = to_regclass('public.intelligence_reports')
        and attname = 'eligible_snapshot_count' and not attisdropped
    )),
    (exists (
      select 1 from pg_catalog.pg_attribute
      where attrelid = to_regclass('public.intelligence_reports')
        and attname = 'eligible_snapshot_fingerprint' and not attisdropped
    )),
    (to_regprocedure(
      'public.create_initial_source_revision(jsonb)'
    ) is not null),
    (to_regprocedure('public.append_source_revision(jsonb)') is not null),
    (to_regprocedure('public.annotate_source_revision(jsonb)') is not null),
    (to_regprocedure('public.confirm_source_assignment(jsonb)') is not null),
    (to_regprocedure(
      'public.get_analysis_eligible_snapshot(text)'
    ) is not null),
    (to_regprocedure(
      'public.save_intelligence_report_legacy_0009(jsonb,jsonb)'
    ) is not null),
    (to_regprocedure('public.sha256_length_framed(text[])') is not null),
    (to_regprocedure(
      'public.source_revision_set_fingerprint(text[])'
    ) is not null),
    (exists (
      select 1 from pg_catalog.pg_roles
      where rolname = 'vsee_registry_owner'
    ))
), expected_constraints(
  relation_name, constraint_name, constraint_type, definition
) as (
  values
    ('deals', 'deals_status_check', 'c',
      'CHECK ((status = ANY (ARRAY['
        || '''screening''::text, ''watchlist''::text, '
        || '''evaluating''::text, ''passed''::text, '
        || '''invested''::text])))'),
    ('source_revisions', 'source_revisions_pkey', 'p',
      'PRIMARY KEY (workspace_id, id)'),
    ('source_revisions',
      'source_revisions_workspace_source_revision_unique', 'u',
      'UNIQUE (workspace_id, source_id, revision)'),
    ('source_revisions',
      'source_revisions_workspace_source_id_unique', 'u',
      'UNIQUE (workspace_id, source_id, id)'),
    ('source_revisions', 'source_revisions_initial_link_check', 'c',
      'CHECK ((((revision = 1) AND '
        || '(supersedes_revision_id IS NULL)) OR ((revision > 1) '
        || 'AND (supersedes_revision_id IS NOT NULL))))'),
    ('source_revisions', 'source_revisions_exact_supersedes_fkey', 'f',
      'FOREIGN KEY (workspace_id, source_id, supersedes_revision_id) '
        || 'REFERENCES source_revisions(workspace_id, source_id, id)'),
    ('source_revision_annotations',
      'source_revision_annotations_pkey', 'p',
      'PRIMARY KEY (workspace_id, id)'),
    ('source_revision_annotations',
      'source_revision_annotations_workspace_revision_fkey', 'f',
      'FOREIGN KEY (workspace_id, revision_id) '
        || 'REFERENCES source_revisions(workspace_id, id) ON DELETE CASCADE'),
    ('source_revision_annotations',
      'source_revision_annotations_workspace_run_fkey', 'f',
      'FOREIGN KEY (workspace_id, superseded_by_run_id) '
        || 'REFERENCES scan_runs(workspace_id, id)'),
    ('deal_source_assignments', 'deal_source_assignments_pkey', 'p',
      'PRIMARY KEY (workspace_id, id)'),
    ('deal_source_assignments',
      'deal_source_assignments_workspace_request_unique', 'u',
      'UNIQUE (workspace_id, request_id)'),
    ('deal_source_assignments',
      'deal_source_assignments_workspace_deal_fkey', 'f',
      'FOREIGN KEY (workspace_id, deal_id) '
        || 'REFERENCES deals(workspace_id, id) ON DELETE CASCADE'),
    ('deal_source_assignments',
      'deal_source_assignments_exact_revision_fkey', 'f',
      'FOREIGN KEY (workspace_id, source_id, source_revision_id) '
        || 'REFERENCES source_revisions(workspace_id, source_id, id)'),
    ('deal_source_assignments',
      'deal_source_assignments_supersession_time_check', 'c',
      'CHECK (((superseded_at IS NULL) OR '
        || '(superseded_at >= created_at)))'),
    ('source_evidence', 'source_evidence_exact_revision_fkey', 'f',
      'FOREIGN KEY (workspace_id, document_id, source_revision_id) '
        || 'REFERENCES source_revisions(workspace_id, source_id, id)'),
    ('deal_interactions', 'deal_interactions_exact_revision_fkey', 'f',
      'FOREIGN KEY (workspace_id, document_id, source_revision_id) '
        || 'REFERENCES source_revisions(workspace_id, source_id, id)'),
    ('intelligence_reports',
      'intelligence_reports_eligible_snapshot_check', 'c',
      'CHECK ((((eligible_snapshot_count IS NULL) AND '
        || '(eligible_snapshot_fingerprint IS NULL)) OR '
        || '((eligible_snapshot_count >= 0) AND '
        || '(btrim(eligible_snapshot_fingerprint) <> ''''::text))))')
), constraints_exact as (
  select not exists (
    select 1
    from expected_constraints as expected
    left join pg_catalog.pg_constraint as actual
      on actual.conrelid = to_regclass(
        'public.' || expected.relation_name
      )
      and actual.conname = expected.constraint_name
      and actual.contype = expected.constraint_type::"char"
      and pg_catalog.pg_get_constraintdef(actual.oid)
        = expected.definition
    where actual.oid is null
  ) as complete
), expected_functions(signature, language_name, security_definer) as (
  values
    ('public.sha256_length_framed(text[])', 'sql', false),
    ('public.canonical_utc_iso_milliseconds(timestamp with time zone)',
      'sql', false),
    ('public.source_revision_set_fingerprint(text[])', 'sql', false),
    ('public.get_analysis_eligible_snapshot(text)', 'plpgsql', true),
    ('public.create_initial_source_revision(jsonb)', 'plpgsql', true),
    ('public.append_source_revision(jsonb)', 'plpgsql', true),
    ('public.annotate_source_revision(jsonb)', 'plpgsql', true),
    ('public.confirm_source_assignment(jsonb)', 'plpgsql', true),
    ('public.save_intelligence_report(jsonb,jsonb)', 'plpgsql', true),
    ('public.reset_intelligence_products(text)', 'plpgsql', true),
    ('public.source_assignment_result(deals,source_revisions,text[],boolean)',
      'sql', false)
), functions_exact as (
  select
    not exists (
      select 1
      from expected_functions as expected
      left join pg_catalog.pg_proc as procedure_record
        on procedure_record.oid =
          to_regprocedure(expected.signature)
      left join pg_catalog.pg_language as language_record
        on language_record.oid = procedure_record.prolang
      left join pg_catalog.pg_roles as owner_role
        on owner_role.oid = procedure_record.proowner
      where procedure_record.oid is null
        or language_record.lanname <> expected.language_name
        or procedure_record.prosecdef <> expected.security_definer
        or procedure_record.proconfig
          is distinct from array['search_path=""']::text[]
        or owner_role.rolname <> 'vsee_registry_owner'
    )
    and exists (
      select 1
      from pg_catalog.pg_proc as procedure_record
      where procedure_record.oid =
        to_regprocedure('public.save_intelligence_report(jsonb,jsonb)')
        and lower(pg_catalog.pg_get_functiondef(procedure_record.oid))
          like '%authoritative_snapshot :=%'
        and lower(pg_catalog.pg_get_functiondef(procedure_record.oid))
          like '%existing_report.run_id <> target_run_id%'
        and lower(pg_catalog.pg_get_functiondef(procedure_record.oid))
          like '%submitted_deal_ids is distinct from authoritative_deal_ids%'
    )
    and exists (
      select 1
      from pg_catalog.pg_proc as procedure_record
      join pg_catalog.pg_language as language_record
        on language_record.oid = procedure_record.prolang
      where procedure_record.oid = to_regprocedure(
        'public.save_intelligence_report_legacy_0009(jsonb,jsonb)'
      )
        and language_record.lanname = 'plpgsql'
        and not procedure_record.prosecdef
        and procedure_record.proconfig
          = array['search_path=pg_catalog, public']::text[]
        and lower(pg_catalog.pg_get_functiondef(procedure_record.oid))
          like '%on conflict (workspace_id, id)%'
    ) as complete
), role_exact as (
  select exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'vsee_registry_owner'
      and not rolsuper
      and not rolinherit
      and not rolcreaterole
      and not rolcreatedb
      and not rolcanlogin
      and not rolreplication
      and not rolbypassrls
  )
  and not exists (
    select 1
    from pg_catalog.pg_auth_members
    where roleid = (
      select oid from pg_catalog.pg_roles
      where rolname = 'vsee_registry_owner'
    )
      or member = (
        select oid from pg_catalog.pg_roles
        where rolname = 'vsee_registry_owner'
      )
  ) as complete
), rls_exact as (
  select not exists (
    select 1
    from (
      values
        ('source_revisions'),
        ('source_revision_annotations'),
        ('deal_source_assignments')
    ) as expected(relation_name)
    left join pg_catalog.pg_class as relation
      on relation.oid = to_regclass(
        'public.' || expected.relation_name
      )
    where relation.oid is null
      or not relation.relrowsecurity
      or relation.relforcerowsecurity
  ) as complete
), expected_triggers(relation_name, trigger_name, function_name) as (
  values
    ('source_revisions', 'source_revisions_validate_insert',
      'validate_source_revision_insert'),
    ('source_revisions', 'source_revisions_immutable',
      'reject_immutable_source_registry_mutation'),
    ('source_revision_annotations',
      'source_revision_annotations_immutable',
      'reject_immutable_source_registry_mutation')
), triggers_exact as (
  select
    not exists (
      select 1
      from expected_triggers as expected
      left join pg_catalog.pg_trigger as trigger_record
        on trigger_record.tgrelid = to_regclass(
          'public.' || expected.relation_name
        )
        and trigger_record.tgname = expected.trigger_name
        and not trigger_record.tgisinternal
      left join pg_catalog.pg_proc as procedure_record
        on procedure_record.oid = trigger_record.tgfoid
      where trigger_record.oid is null
        or trigger_record.tgenabled <> 'O'
        or procedure_record.proname <> expected.function_name
    )
    and (
      select count(*)
      from pg_catalog.pg_trigger
      where tgrelid in (
        to_regclass('public.source_revisions'),
        to_regclass('public.source_revision_annotations')
      )
        and not tgisinternal
    ) = 3 as complete
), expected_policies(relation_name, policy_name) as (
  values
    ('source_revisions', 'source_revisions_registry_owner'),
    ('source_revision_annotations', 'source_annotations_registry_owner'),
    ('deal_source_assignments', 'source_assignments_registry_owner'),
    ('companies', 'companies_registry_owner'),
    ('deals', 'deals_registry_owner'),
    ('intelligence_reports', 'intelligence_reports_registry_owner'),
    ('company_analyses', 'company_analyses_registry_owner')
), policies_exact as (
  select not exists (
    select 1
    from expected_policies as expected
    left join pg_catalog.pg_policy as policy_record
      on policy_record.polrelid = to_regclass(
        'public.' || expected.relation_name
      )
      and policy_record.polname = expected.policy_name
    where policy_record.oid is null
      or not policy_record.polpermissive
      or policy_record.polcmd <> '*'
      or policy_record.polroles
        <> array[(
          select oid from pg_catalog.pg_roles
          where rolname = 'vsee_registry_owner'
        )]
      or pg_catalog.pg_get_expr(
        policy_record.polqual,
        policy_record.polrelid
      ) <> 'true'
      or pg_catalog.pg_get_expr(
        policy_record.polwithcheck,
        policy_record.polrelid
      ) <> 'true'
  ) as complete
), service_role_exact as (
  select
    not exists (
      select 1 from pg_catalog.pg_roles
      where rolname = 'service_role'
    )
    or (
      not exists (
        select 1
        from (
          values
            ('source_revisions'),
            ('source_revision_annotations'),
            ('deal_source_assignments'),
            ('intelligence_reports'),
            ('company_analyses')
        ) as target(relation_name)
        where not pg_catalog.has_table_privilege(
          (
            select oid from pg_catalog.pg_roles
            where rolname = 'service_role'
          ),
          to_regclass('public.' || target.relation_name),
          'SELECT'
        )
          or pg_catalog.has_table_privilege(
            (
              select oid from pg_catalog.pg_roles
              where rolname = 'service_role'
            ),
            to_regclass('public.' || target.relation_name),
            'INSERT,UPDATE,DELETE,TRUNCATE'
          )
      )
      and not pg_catalog.has_table_privilege(
        (
          select oid from pg_catalog.pg_roles
          where rolname = 'service_role'
        ),
        to_regclass('public.companies'),
        'DELETE,TRUNCATE'
      )
      and not pg_catalog.has_table_privilege(
        (
          select oid from pg_catalog.pg_roles
          where rolname = 'service_role'
        ),
        to_regclass('public.deals'),
        'INSERT,UPDATE,DELETE,TRUNCATE'
      )
      and not exists (
        select 1
        from (
          values
            ('public.create_initial_source_revision(jsonb)'),
            ('public.append_source_revision(jsonb)'),
            ('public.annotate_source_revision(jsonb)'),
            ('public.confirm_source_assignment(jsonb)'),
            ('public.save_intelligence_report(jsonb,jsonb)'),
            ('public.reset_intelligence_products(text)'),
            ('public.get_analysis_eligible_snapshot(text)')
        ) as target(signature)
        where not pg_catalog.has_function_privilege(
          (
            select oid from pg_catalog.pg_roles
            where rolname = 'service_role'
          ),
          to_regprocedure(target.signature),
          'EXECUTE'
        )
      )
      and not pg_catalog.has_function_privilege(
        (
          select oid from pg_catalog.pg_roles
          where rolname = 'service_role'
        ),
        to_regprocedure(
          'public.save_intelligence_report_legacy_0009(jsonb,jsonb)'
        ),
        'EXECUTE'
      )
    ) as complete
), restricted_roles_exact as (
  select not exists (
    select 1
    from pg_catalog.pg_roles as role_record
    cross join lateral (
      values
        ('public.create_initial_source_revision(jsonb)'),
        ('public.append_source_revision(jsonb)'),
        ('public.annotate_source_revision(jsonb)'),
        ('public.confirm_source_assignment(jsonb)'),
        ('public.save_intelligence_report(jsonb,jsonb)'),
        ('public.reset_intelligence_products(text)'),
        ('public.get_analysis_eligible_snapshot(text)')
    ) as target(signature)
    where role_record.rolname in ('anon', 'authenticated')
      and pg_catalog.has_function_privilege(
        role_record.oid,
        to_regprocedure(target.signature),
        'EXECUTE'
      )
  ) as complete
), exact_postconditions as (
  select
    (select complete from constraints_exact)
    and (select complete from functions_exact)
    and (select complete from role_exact)
    and (select complete from rls_exact)
    and (select complete from triggers_exact)
    and (select complete from policies_exact)
    and (select complete from service_role_exact)
    and (select complete from restricted_roles_exact) as complete
)
select case
  when
    (select pg_catalog.bool_and(value) from schema_presence)
    and (select complete from exact_postconditions)
  then 'complete'
  when not (select pg_catalog.bool_or(value) from schema_presence)
  then 'absent'
  else 'partial'
end;
SQL
      ;;
    *)
      print -u2 "Unknown baseline state: $1"
      return 1
      ;;
  esac
}

forward_sentinel_sql() {
  case "$1" in
    0010) print -- "-- vsee-sentinel: 0010\nselect to_regclass('public.fund_policy_versions') is not null;" ;;
    0011) print -- "-- vsee-sentinel: 0011\nselect to_regclass('public.underwriting_batches') is not null;" ;;
    0012) print -- "-- vsee-sentinel: 0012\nselect to_regclass('public.source_evidence_items') is not null;" ;;
    0013) print -- "-- vsee-sentinel: 0013\nselect exists (select 1 from pg_catalog.pg_attribute where attrelid = to_regclass('public.uploaded_documents') and attname = 'confirmation_fingerprint' and not attisdropped);" ;;
    0014) print -- "-- vsee-sentinel: 0014\nselect to_regprocedure('public.replace_action_draft_body(text,text,text)') is not null;" ;;
    0015) print -- "-- vsee-sentinel: 0015\nselect exists (select 1 from pg_catalog.pg_constraint where conrelid = to_regclass('public.candidate_checkpoints') and conname = 'candidate_checkpoints_stage_check' and pg_catalog.pg_get_constraintdef(oid) like '%framework_catalog%');" ;;
    0016) print -- "-- vsee-sentinel: 0016\nselect to_regclass('public.source_evidence_items') is not null and exists (select 1 from pg_catalog.pg_attribute where attrelid = to_regclass('public.source_evidence_items') and attname = 'source_id' and attnotnull and not attisdropped);" ;;
    0017) print -- "-- vsee-sentinel: 0017\nselect to_regclass('public.workspace_test_generations') is not null and to_regprocedure('public.reset_test_view(text,text)') is not null;" ;;
    *)
      print -u2 "Unknown forward sentinel: $1"
      return 1
      ;;
  esac
}

registry_backfill_is_exact() {
  local result
  if ! result="$(
    psql --no-password -v ON_ERROR_STOP=1 -At -c "
      -- vsee-registry-backfill
      select
        not exists (
          select 1
          from public.deals as deal
          left join lateral (
            select array_agg(
              assignment.source_revision_id
              order by assignment.source_revision_id collate \"C\"
            ) as revision_ids
            from public.deal_source_assignments as assignment
            where assignment.workspace_id = deal.workspace_id
              and assignment.deal_id = deal.id
              and assignment.superseded_at is null
          ) as active on true
          where (
            (deal.analysis_eligible_at is not null)
              <> (coalesce(cardinality(active.revision_ids), 0) > 0)
          )
            or (
              deal.analysis_eligible_at is not null
              and deal.active_source_revision_fingerprint
                is distinct from
                public.source_revision_set_fingerprint(
                  active.revision_ids
                )
            )
        )
        and not exists (
          select 1
          from public.source_evidence
          where document_id is not null
            and source_revision_id is null
        )
        and not exists (
          select 1
          from public.deal_interactions
          where document_id is not null
            and source_revision_id is null
        );
    "
  )"; then
    return 1
  fi
  [[ "$result" == "t" ]]
}

inspect_baseline_state() {
  local result
  if ! result="$(
    psql --no-password -v ON_ERROR_STOP=1 -At \
      -c "$(baseline_state_sql "$1")"
  )"; then
    print -u2 "Could not inspect production baseline state: $1"
    return 1
  fi
  case "$result" in
    complete|absent|partial|prototype_safe|prototype_unsafe|bridged_safe|bridged_unsafe)
      if [[ "$1" == "0009" && "$result" == "complete" ]] \
        && ! registry_backfill_is_exact; then
        result="partial"
      fi
      BASELINE_STATE="$result"
      ;;
    *)
      print -u2 "Could not inspect production baseline state: $1"
      return 1
      ;;
  esac
}

inspect_forward_sentinel() {
  local result
  if ! result="$(
    psql --no-password -v ON_ERROR_STOP=1 -At \
      -c "$(forward_sentinel_sql "$1")"
  )"; then
    print -u2 "Could not verify forward migration sentinel: $1"
    return 1
  fi
  case "$result" in
    t) FORWARD_STATE="complete" ;;
    f) FORWARD_STATE="incomplete" ;;
    *)
      print -u2 "Could not verify forward migration sentinel: $1"
      return 1
      ;;
  esac
}

inspect_quiescence() {
  local result
  if ! result="$(
    psql --no-password -v ON_ERROR_STOP=1 -At -c "
      -- vsee-baseline-quiescence
      select
        not exists (
          select 1
          from public.scan_runs
          where status in ('queued', 'running')
            or lease_expires_at is not null
        )
        and not exists (
          select 1
          from public.uploaded_documents
          where status in ('extracting', 'ingesting_memory')
            or lease_expires_at is not null
        );
    "
  )"; then
    print -u2 "Could not verify the no-writer maintenance precondition."
    return 1
  fi
  if [[ "$result" != "t" ]]; then
    print -u2 "Active scans or upload leases remain; refusing production mutation."
    return 1
  fi
}

assert_mutation_preconditions() {
  if ! inspect_baseline_state 0007; then
    return 1
  fi
  case "$BASELINE_STATE" in
    complete|bridged_safe|prototype_safe) ;;
    *)
      print -u2 "The 0007 baseline or retained legacy payload changed during maintenance."
      return 1
      ;;
  esac
  inspect_quiescence
}

typeset -A baseline_states
for migration_id in 0007 0008 0009; do
  if ! inspect_baseline_state "$migration_id"; then
    exit 1
  fi
  baseline_states[$migration_id]="$BASELINE_STATE"
done

forward_ids=(0010 0011 0012 0013 0014 0015 0016 0017)
typeset -A forward_states
for migration_id in "${forward_ids[@]}"; do
  if ! inspect_forward_sentinel "$migration_id"; then
    exit 1
  fi
  forward_states[$migration_id]="$FORWARD_STATE"
done

case "${baseline_states[0007]}" in
  complete|prototype_safe|bridged_safe) ;;
  prototype_unsafe|bridged_unsafe)
    print -u2 "The 0007 prototype or bridged schema contains active state or meaningful legacy payload; refusing automatic migration."
    exit 1
    ;;
  *)
    print -u2 "The 0007 production baseline is partial or unknown; refusing automatic migration."
    exit 1
    ;;
esac

for migration_id in 0008 0009; do
  if [[ "${baseline_states[$migration_id]}" == "partial" ]]; then
    print -u2 "Migration ${migration_id} is partial; refusing automatic migration."
    exit 1
  fi
done

if [[ "${baseline_states[0008]}" == "absent" \
  && "${baseline_states[0009]}" == "complete" ]]; then
  print -u2 "Migration gap: 0009 is complete while 0008 is absent."
  exit 1
fi

baseline_is_incomplete=false
if [[ "${baseline_states[0007]}" != "complete" \
  && "${baseline_states[0007]}" != "bridged_safe" ]]; then
  baseline_is_incomplete=true
fi
if [[ "${baseline_states[0008]}" != "complete" \
  || "${baseline_states[0009]}" != "complete" ]]; then
  baseline_is_incomplete=true
fi

if [[ "$baseline_is_incomplete" == "true" ]]; then
  for migration_id in "${forward_ids[@]}"; do
    if [[ "${forward_states[$migration_id]}" == "complete" ]]; then
      print -u2 "Migration gap: ${migration_id} is complete before the 0009 baseline."
      exit 1
    fi
  done
fi

if [[ "${baseline_states[0007]}" == "prototype_safe" ]]; then
  if ! assert_mutation_preconditions; then
    exit 1
  fi
  print "Applying the guarded 0007 compatibility bridge."
  psql --no-password -v ON_ERROR_STOP=1 -f "$bridge_file"
  if ! inspect_baseline_state 0007 \
    || [[ "$BASELINE_STATE" != "bridged_safe" ]]; then
    print -u2 "The 0007 compatibility bridge did not satisfy its postcondition."
    exit 1
  fi
fi

if [[ "${baseline_states[0008]}" == "absent" ]]; then
  if ! assert_mutation_preconditions; then
    exit 1
  fi
  print "Applying migration 0008."
  psql --no-password -v ON_ERROR_STOP=1 -f "$migration_0008"
  if ! inspect_baseline_state 0008 \
    || [[ "$BASELINE_STATE" != "complete" ]]; then
    print -u2 "Migration 0008 did not satisfy its postcondition."
    exit 1
  fi
fi

if [[ "${baseline_states[0009]}" == "absent" ]]; then
  if ! assert_mutation_preconditions; then
    exit 1
  fi
  print "Applying migration 0009."
  psql --no-password -v ON_ERROR_STOP=1 -f "$migration_0009"
  if ! inspect_baseline_state 0009 \
    || [[ "$BASELINE_STATE" != "complete" ]]; then
    print -u2 "Migration 0009 did not satisfy its postcondition."
    exit 1
  fi
fi

print "Production baseline through 0009 is complete."
print "Continue with ./scripts/apply-production-migrations.zsh for 0010 through 0017."
