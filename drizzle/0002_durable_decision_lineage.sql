begin;

alter table public.deal_interactions
  add column if not exists decision_reason text;

update public.deal_interactions
set decision_reason =
  'Synthetic fallback: the original demo decision rationale was not persisted before this migration.'
where decision_reason is null or btrim(decision_reason) = '';

alter table public.deal_interactions
  alter column decision_reason set not null;

alter table public.xtrace_ingest_jobs
  add column if not exists bundle_fingerprint text,
  add column if not exists serializer_version text;

update public.xtrace_ingest_jobs
set bundle_fingerprint = 'legacy-unfingerprinted'
where bundle_fingerprint is null or btrim(bundle_fingerprint) = '';

update public.xtrace_ingest_jobs
set serializer_version = 'legacy-v0'
where serializer_version is null or btrim(serializer_version) = '';

alter table public.xtrace_ingest_jobs
  alter column bundle_fingerprint set not null,
  alter column serializer_version set not null;

commit;
