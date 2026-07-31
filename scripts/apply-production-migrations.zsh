#!/bin/zsh
set -euo pipefail

script_directory="${0:A:h}"
repository_root="${script_directory:h}"

if [[ ! -d "${repository_root}/drizzle" ]]; then
  print -u2 "Unable to locate the migration directory."
  exit 1
fi

cd "${repository_root}"

if ! DATABASE_URL="$(security find-generic-password -a "$USER" -s "vsee-supabase-db-url" -w)"; then
  print -u2 "Required Keychain service unavailable: vsee-supabase-db-url"
  exit 1
fi

if [[ -z "$DATABASE_URL" ]]; then
  print -u2 "Required Keychain service is empty: vsee-supabase-db-url"
  exit 1
fi

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
    0013) print -- "-- vsee-sentinel: 0013\nselect exists (select 1 from pg_attribute where attrelid = 'public.uploaded_documents'::regclass and attname = 'confirmation_fingerprint' and not attisdropped);" ;;
    0014) print -- "-- vsee-sentinel: 0014\nselect to_regprocedure('public.replace_action_draft_body(text,text,text)') is not null;" ;;
    0015) print -- "-- vsee-sentinel: 0015\nselect exists (select 1 from pg_constraint where conrelid = 'public.candidate_checkpoints'::regclass and conname = 'candidate_checkpoints_stage_check' and pg_get_constraintdef(oid) like '%framework_catalog%');" ;;
    0016) print -- "-- vsee-sentinel: 0016\nselect to_regclass('public.source_evidence_items') is not null and exists (select 1 from pg_attribute where attrelid = 'public.source_evidence_items'::regclass and attname = 'source_id' and attnotnull and not attisdropped);" ;;
    0017) print -- "-- vsee-sentinel: 0017\nselect to_regclass('public.workspace_test_generations') is not null and to_regprocedure('public.reset_test_view(text,text)') is not null;" ;;
    *) print -u2 "Unknown migration sentinel: $1"; return 1 ;;
  esac
}

inspect_sentinel() {
  local result
  if ! result="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -At -c "$(sentinel_sql "$1")")"; then
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

if ! inspect_sentinel 0009; then
  exit 1
fi

if [[ "$SENTINEL_STATE" != "complete" ]]; then
  print -u2 "Migration boundary 0009 is incomplete; refusing to apply forward migrations."
  exit 1
fi

migration_ids=(0010 0011 0012 0013 0014 0015 0016 0017)
migration_files=(
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
  elif (( first_incomplete_index == 0 )); then
    first_incomplete_index=$index
  fi
done

if (( first_incomplete_index == 0 )); then
  print "All production migration sentinels through 0017 are complete."
  exit 0
fi

for index in {$first_incomplete_index..${#migration_ids}}; do
  migration_id="${migration_ids[$index]}"
  migration_file="${repository_root}/drizzle/${migration_files[$index]}"
  if [[ ! -f "$migration_file" ]]; then
    print -u2 "Migration file is missing for ${migration_id}."
    exit 1
  fi

  print "Applying migration ${migration_id}."
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration_file"
  if ! inspect_sentinel "$migration_id"; then
    exit 1
  fi
  if [[ "$SENTINEL_STATE" != "complete" ]]; then
    print -u2 "Migration ${migration_id} did not satisfy its sentinel; stopping."
    exit 1
  fi
done
