-- Forward-only migration: reserve a replay-safe catalog checkpoint stage.
begin;

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
