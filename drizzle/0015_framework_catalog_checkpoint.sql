-- Forward-only migration: reserve a replay-safe catalog checkpoint stage.
begin;

set local transaction isolation level read committed;

lock table
  public.candidate_checkpoints,
  public.scan_runs,
  public.uploaded_documents
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

alter table public.candidate_checkpoints
  drop constraint if exists candidate_checkpoints_stage_check;

alter table public.candidate_checkpoints
  add constraint candidate_checkpoints_stage_check
  check (
    stage in (
      'evidence_pack',
      'context_router',
      'valuation',
      'framework_catalog',
      'framework_lenses',
      'decision',
      'narrative_drafts',
      'finalization'
    )
  );

commit;
