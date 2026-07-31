#!/bin/zsh
set +x
set -euo pipefail

script_directory="${0:A:h}"
repository_root="${script_directory:h}"
libpq_service_renderer="${script_directory}/render-private-libpq-service.mjs"
catalog_manifest="${script_directory}/sql/production-baseline-catalog-manifest.sql"
catalog_hasher="${script_directory}/hash-stdin-sha256.mjs"
catalog_fingerprints="${script_directory}/production-catalog-fingerprints.zsh"
registry_invariants="${script_directory}/sql/production-registry-data-invariants.sql"

for required_path in \
  "${repository_root}/drizzle" \
  "$libpq_service_renderer" \
  "$catalog_manifest" \
  "$catalog_hasher" \
  "$catalog_fingerprints" \
  "$registry_invariants"; do
  if [[ ! -e "$required_path" ]]; then
    print -u2 "Required production migration resource is missing: ${required_path:t}"
    exit 1
  fi
done

source "$catalog_fingerprints"
cd "$repository_root"

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

sentinel_sql() {
  case "$1" in
    0009)
      cat <<'SQL'
-- vsee-sentinel: 0009
select
  to_regclass('public.deals') is not null
  and to_regclass('public.companies') is not null
  and to_regclass('public.deal_source_assignments') is not null
  and to_regprocedure(
    'public.confirm_source_assignment(jsonb)'
  ) is not null;
SQL
      ;;
    0010) print -- "-- vsee-sentinel: 0010\nselect to_regclass('public.fund_policy_versions') is not null;" ;;
    0011) print -- "-- vsee-sentinel: 0011\nselect to_regclass('public.underwriting_batches') is not null;" ;;
    0012) print -- "-- vsee-sentinel: 0012\nselect to_regclass('public.source_evidence_items') is not null;" ;;
    0013) print -- "-- vsee-sentinel: 0013\nselect exists (select 1 from pg_catalog.pg_attribute where attrelid = to_regclass('public.uploaded_documents') and attname = 'confirmation_fingerprint' and not attisdropped);" ;;
    0014) print -- "-- vsee-sentinel: 0014\nselect to_regprocedure('public.replace_action_draft_body(text,text,text)') is not null;" ;;
    0015) print -- "-- vsee-sentinel: 0015\nselect exists (select 1 from pg_catalog.pg_constraint where conrelid = to_regclass('public.candidate_checkpoints') and conname = 'candidate_checkpoints_stage_check' and pg_catalog.pg_get_constraintdef(oid) like '%framework_catalog%');" ;;
    0016) print -- "-- vsee-sentinel: 0016\nselect to_regclass('public.source_evidence_items') is not null and exists (select 1 from pg_catalog.pg_attribute where attrelid = to_regclass('public.source_evidence_items') and attname = 'source_id' and attnotnull and not attisdropped);" ;;
    0017) print -- "-- vsee-sentinel: 0017\nselect to_regclass('public.workspace_test_generations') is not null and to_regprocedure('public.reset_test_view(text,text)') is not null;" ;;
    *) print -u2 "Unknown migration sentinel: $1"; return 1 ;;
  esac
}

inspect_sentinel() {
  local result
  if ! result="$(
    psql --no-password -v ON_ERROR_STOP=1 -At -c "$(sentinel_sql "$1")"
  )"; then
    print -u2 "Could not verify migration sentinel: $1"
    return 1
  fi
  case "$result" in
    t) SENTINEL_STATE="complete" ;;
    f) SENTINEL_STATE="incomplete" ;;
    *)
      print -u2 "Could not verify migration sentinel: $1"
      return 1
      ;;
  esac
}

inspect_catalog_fingerprint() {
  if ! CATALOG_FINGERPRINT="$(
    psql --no-password -v ON_ERROR_STOP=1 -At -c "-- vsee-sentinel: 0009
$(<"$catalog_manifest")" \
      | node "$catalog_hasher"
  )"; then
    print -u2 "Could not inspect the exact production catalog."
    return 1
  fi
  if ! CATALOG_VARIANT="$(vsee_catalog_variant "$CATALOG_FINGERPRINT")"; then
    print -u2 "The application-owned production catalog is not a reviewed PostgreSQL 17 state."
    return 1
  fi
}

assert_catalog_stage() {
  local stage="$1"
  if ! inspect_catalog_fingerprint; then
    return 1
  fi
  if ! vsee_catalog_matches_stage "$stage" "$CATALOG_FINGERPRINT"; then
    print -u2 "Catalog mismatch: migration ${stage} does not match the reviewed manifest (${CATALOG_VARIANT})."
    return 1
  fi
}

assert_registry_invariants() {
  local result
  if ! result="$(
    psql --no-password -v ON_ERROR_STOP=1 -At -c "-- vsee-sentinel: 0009
$(<"$registry_invariants")"
  )"; then
    print -u2 "Could not verify source-registry data invariants."
    return 1
  fi
  if [[ "$result" != "t" ]]; then
    print -u2 "Source-registry data invariants are not satisfied."
    return 1
  fi
}

migration_ids=(0009 0010 0011 0012 0013 0014 0015 0016 0017)
migration_files=(
  ''
  0010_underwriting_references.sql
  0011_underwriting_runs.sql
  0012_source_grounded_underwriting.sql
  0013_confirmed_upload_ingest.sql
  0014_read_api_action_drafts.sql
  0015_framework_catalog_checkpoint.sql
  0016_confirmed_upload_source_evidence_bridge.sql
  0017_public_sandbox_test_generations.sql
)

first_incomplete_index=0
last_complete_id=''
for index in {1..${#migration_ids}}; do
  migration_id="${migration_ids[$index]}"
  if ! inspect_sentinel "$migration_id"; then
    exit 1
  fi
  if [[ "$SENTINEL_STATE" == "complete" ]]; then
    if (( first_incomplete_index > 0 )); then
      print -u2 "Migration sentinel gap: ${migration_id} is complete after ${migration_ids[$first_incomplete_index]} is incomplete."
      exit 1
    fi
    last_complete_id="$migration_id"
  elif (( first_incomplete_index == 0 )); then
    first_incomplete_index=$index
  fi
done

if [[ "$last_complete_id" == '' ]]; then
  print -u2 "Migration boundary 0009 is incomplete; refusing to apply forward migrations."
  exit 1
fi

if ! assert_catalog_stage "$last_complete_id" || ! assert_registry_invariants; then
  exit 1
fi

if (( first_incomplete_index == 0 )); then
  print "All production migrations through 0017 match their reviewed catalog and data invariants."
  exit 0
fi

for index in {$first_incomplete_index..${#migration_ids}}; do
  migration_id="${migration_ids[$index]}"
  migration_file="${repository_root}/drizzle/${migration_files[$index]}"
  if [[ ! -f "$migration_file" ]]; then
    print -u2 "Migration file is missing for ${migration_id}."
    exit 1
  fi

  # Recheck the exact boundary immediately before each mutating transaction.
  if ! assert_catalog_stage "$last_complete_id" || ! assert_registry_invariants; then
    exit 1
  fi

  print "Applying migration ${migration_id}."
  psql --no-password -v ON_ERROR_STOP=1 -f "$migration_file"
  if ! inspect_sentinel "$migration_id"; then
    exit 1
  fi
  if [[ "$SENTINEL_STATE" != "complete" ]]; then
    print -u2 "Migration ${migration_id} did not satisfy its sentinel; stopping."
    exit 1
  fi
  if ! assert_catalog_stage "$migration_id" || ! assert_registry_invariants; then
    print -u2 "Migration ${migration_id} did not satisfy its exact postcondition; stopping."
    exit 1
  fi
  last_complete_id="$migration_id"
done

print "Production migrations through 0017 are complete and verified."
