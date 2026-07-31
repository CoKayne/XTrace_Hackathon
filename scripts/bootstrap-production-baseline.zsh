#!/bin/zsh
set -euo pipefail

script_directory="${0:A:h}"
repository_root="${script_directory:h}"
bridge_file="${script_directory}/sql/upgrade-prototype-uploaded-documents-to-0007.sql"
migration_0008="${repository_root}/drizzle/0008_workspace_composite_identity.sql"
migration_0009="${repository_root}/drizzle/0009_source_revision_deal_registry.sql"

for required_file in "$bridge_file" "$migration_0008" "$migration_0009"; do
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

baseline_state_sql() {
  case "$1" in
    0007)
      cat <<'SQL'
-- vsee-baseline-state: 0007
with prerequisite as (
  select
    to_regclass('public.workspaces') is not null
    and to_regclass('public.scan_runs') is not null
    and to_regclass('public.scan_run_steps') is not null
    and to_regclass('public.companies') is not null
    and to_regclass('public.deals') is not null
    and to_regclass('public.source_evidence') is not null
    and to_regclass('public.deal_interactions') is not null
    and to_regclass('public.intelligence_reports') is not null
    and to_regclass('public.company_analyses') is not null
    and to_regclass('public.xtrace_ingest_jobs') is not null
    and to_regclass('public.xtrace_memory_links') is not null
    and to_regclass('public.reasoner_judgments') is not null
    and to_regclass('public.uploaded_documents') is not null
    and to_regprocedure(
      'public.save_intelligence_report(jsonb,jsonb)'
    ) is not null
    and exists (
      select 1
      from pg_catalog.pg_extension
      where extname = 'pgcrypto'
    )
    and exists (
      select 1
      from pg_catalog.pg_attribute
      where attrelid = to_regclass('public.deal_interactions')
        and attname = 'decision_reason'
        and attnotnull
        and not attisdropped
    )
    and exists (
      select 1
      from pg_catalog.pg_attribute
      where attrelid = to_regclass('public.xtrace_ingest_jobs')
        and attname = 'bundle_fingerprint'
        and attnotnull
        and not attisdropped
    )
    and exists (
      select 1
      from pg_catalog.pg_attribute
      where attrelid = to_regclass('public.xtrace_ingest_jobs')
        and attname = 'serializer_version'
        and attnotnull
        and not attisdropped
    )
    and not exists (
      select 1
      from pg_catalog.pg_attribute
      where attrelid = to_regclass('public.intelligence_reports')
        and attname = 'delivery'
        and not attisdropped
    )
    and exists (
      select 1
      from pg_catalog.pg_constraint
      where conrelid = to_regclass('public.deal_interactions')
        and conname = 'deal_interactions_demo_fixture_label_check'
        and pg_catalog.pg_get_constraintdef(oid)
          like '%Sample decision record%'
    ) as complete
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
), upload_constraints as (
  select
    bool_or(
      constraint_record.conname = 'uploaded_documents_status_check'
      and pg_catalog.pg_get_constraintdef(constraint_record.oid)
        like '%awaiting_confirmation%'
      and pg_catalog.pg_get_constraintdef(constraint_record.oid)
        like '%ingesting_memory%'
    ) filter (where constraint_record.contype = 'c') as current_status,
    bool_or(
      constraint_record.conname = 'uploaded_documents_status_check'
      and pg_catalog.pg_get_constraintdef(constraint_record.oid)
        like '%extracting%'
      and pg_catalog.pg_get_constraintdef(constraint_record.oid)
        like '%ready%'
      and pg_catalog.pg_get_constraintdef(constraint_record.oid)
        not like '%awaiting_confirmation%'
    ) filter (where constraint_record.contype = 'c') as prototype_status,
    bool_or(
      constraint_record.contype = 'p'
      and pg_catalog.pg_get_constraintdef(constraint_record.oid)
        = 'PRIMARY KEY (id)'
    ) as prototype_primary_key
  from pg_catalog.pg_constraint as constraint_record
  where constraint_record.conrelid =
    to_regclass('public.uploaded_documents')
), upload_shape as (
  select
    upload_columns.columns,
    upload_constraints.current_status,
    upload_constraints.prototype_status,
    upload_constraints.prototype_primary_key,
    relation.relrowsecurity
  from upload_columns
  cross join upload_constraints
  join pg_catalog.pg_class as relation
    on relation.oid = to_regclass('public.uploaded_documents')
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
    coalesce(upload_shape.current_status, false) as current_status,
    coalesce(upload_shape.prototype_status, false) as prototype_status,
    coalesce(upload_shape.prototype_primary_key, false)
      as prototype_primary_key,
    coalesce(upload_shape.relrowsecurity, false) as rls_enabled,
    upload_safety.safe
  from prerequisite
  left join upload_shape on true
  cross join upload_safety
)
select case
  when not prerequisite_complete then 'partial'
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
    and current_status
    and rls_enabled
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
    and prototype_status
    and prototype_primary_key
    and rls_enabled
  then case when safe then 'prototype_safe' else 'prototype_unsafe' end
  else 'partial'
end
from classified;
SQL
      ;;
    0008)
      cat <<'SQL'
-- vsee-baseline-state: 0008
with markers(value) as (
  values
    (exists (
      select 1 from pg_catalog.pg_attribute
      where attrelid = to_regclass('public.scan_run_steps')
        and attname = 'workspace_id' and attnotnull and not attisdropped
    )),
    (exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = to_regclass('public.companies') and contype = 'p'
        and pg_catalog.pg_get_constraintdef(oid)
          = 'PRIMARY KEY (workspace_id, id)'
    )),
    (exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = to_regclass('public.deals') and contype = 'p'
        and pg_catalog.pg_get_constraintdef(oid)
          = 'PRIMARY KEY (workspace_id, id)'
    )),
    (exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = to_regclass('public.source_evidence')
        and contype = 'p'
        and pg_catalog.pg_get_constraintdef(oid)
          = 'PRIMARY KEY (workspace_id, id)'
    )),
    (exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = to_regclass('public.deal_interactions')
        and contype = 'p'
        and pg_catalog.pg_get_constraintdef(oid)
          = 'PRIMARY KEY (workspace_id, id)'
    )),
    (exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = to_regclass('public.intelligence_reports')
        and contype = 'p'
        and pg_catalog.pg_get_constraintdef(oid)
          = 'PRIMARY KEY (workspace_id, id)'
    )),
    (exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = to_regclass('public.company_analyses')
        and contype = 'p'
        and pg_catalog.pg_get_constraintdef(oid)
          = 'PRIMARY KEY (workspace_id, id)'
    )),
    (exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = to_regclass('public.xtrace_ingest_jobs')
        and contype = 'p'
        and pg_catalog.pg_get_constraintdef(oid)
          = 'PRIMARY KEY (workspace_id, job_id)'
    )),
    (exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = to_regclass('public.xtrace_memory_links')
        and contype = 'p'
        and pg_catalog.pg_get_constraintdef(oid)
          = 'PRIMARY KEY (workspace_id, memory_id)'
    )),
    (exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = to_regclass('public.uploaded_documents')
        and contype = 'p'
        and pg_catalog.pg_get_constraintdef(oid)
          = 'PRIMARY KEY (workspace_id, id)'
    )),
    (exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = to_regclass('public.scan_runs')
        and conname = 'scan_runs_workspace_id_id_unique'
    )),
    (exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = to_regclass('public.scan_run_steps')
        and conname = 'scan_run_steps_workspace_run_fkey'
    )),
    (exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = to_regclass('public.deals')
        and conname = 'deals_workspace_company_fkey'
    )),
    (exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = to_regclass('public.source_evidence')
        and conname = 'source_evidence_workspace_deal_fkey'
    )),
    (exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = to_regclass('public.deal_interactions')
        and conname = 'deal_interactions_workspace_deal_fkey'
    )),
    (exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = to_regclass('public.intelligence_reports')
        and conname = 'intelligence_reports_workspace_run_fkey'
    )),
    (exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = to_regclass('public.company_analyses')
        and conname = 'company_analyses_workspace_report_fkey'
    )),
    (exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = to_regclass('public.company_analyses')
        and conname = 'company_analyses_workspace_run_fkey'
    )),
    (exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = to_regclass('public.company_analyses')
        and conname = 'company_analyses_workspace_deal_fkey'
    )),
    (exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = to_regclass('public.xtrace_ingest_jobs')
        and conname = 'xtrace_ingest_jobs_workspace_deal_fkey'
    )),
    (exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = to_regclass('public.xtrace_memory_links')
        and conname = 'xtrace_memory_links_workspace_deal_fkey'
    ))
)
select case
  when pg_catalog.bool_and(value) then 'complete'
  when not pg_catalog.bool_or(value) then 'absent'
  else 'partial'
end
from markers;
SQL
      ;;
    0009)
      cat <<'SQL'
-- vsee-baseline-state: 0009
with schema_markers(value) as (
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
    ) is not null)
), security_postconditions(value) as (
  values
    (exists (
      select 1 from pg_catalog.pg_roles
      where rolname = 'vsee_registry_owner'
        and not rolsuper
        and not rolinherit
        and not rolcreaterole
        and not rolcreatedb
        and not rolcanlogin
        and not rolreplication
        and not rolbypassrls
    )),
    (exists (
      select 1
      from pg_catalog.pg_class
      where oid = to_regclass('public.source_revisions')
        and relrowsecurity
    )),
    (exists (
      select 1
      from pg_catalog.pg_class
      where oid = to_regclass('public.deal_source_assignments')
        and relrowsecurity
    ))
)
select case
  when
    (select pg_catalog.bool_and(value) from schema_markers)
    and (
      select pg_catalog.bool_and(value)
      from security_postconditions
    )
  then 'complete'
  when not (select pg_catalog.bool_or(value) from schema_markers)
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

inspect_baseline_state() {
  local result
  if ! result="$(
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -At \
      -c "$(baseline_state_sql "$1")"
  )"; then
    print -u2 "Could not inspect production baseline state: $1"
    return 1
  fi
  case "$result" in
    complete|absent|partial|prototype_safe|prototype_unsafe)
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
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -At \
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
  complete|prototype_safe) ;;
  prototype_unsafe)
    print -u2 "The 0007 prototype contains active state or meaningful payload; refusing automatic migration."
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
  || "${baseline_states[0008]}" != "complete" \
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
  print "Applying the guarded 0007 compatibility bridge."
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$bridge_file"
  if ! inspect_baseline_state 0007 \
    || [[ "$BASELINE_STATE" != "complete" ]]; then
    print -u2 "The 0007 compatibility bridge did not satisfy its postcondition."
    exit 1
  fi
fi

if [[ "${baseline_states[0008]}" == "absent" ]]; then
  print "Applying migration 0008."
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration_0008"
  if ! inspect_baseline_state 0008 \
    || [[ "$BASELINE_STATE" != "complete" ]]; then
    print -u2 "Migration 0008 did not satisfy its postcondition."
    exit 1
  fi
fi

if [[ "${baseline_states[0009]}" == "absent" ]]; then
  print "Applying migration 0009."
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration_0009"
  if ! inspect_baseline_state 0009 \
    || [[ "$BASELINE_STATE" != "complete" ]]; then
    print -u2 "Migration 0009 did not satisfy its postcondition."
    exit 1
  fi
fi

print "Production baseline through 0009 is complete."
print "Continue with ./scripts/apply-production-migrations.zsh for 0010 through 0017."
