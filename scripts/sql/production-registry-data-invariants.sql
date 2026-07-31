-- vsee-registry-data-invariants
select
  not exists (
    select 1
    from public.deals as deal
    left join lateral (
      select array_agg(
        assignment.source_revision_id
        order by assignment.source_revision_id collate "C"
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
          public.source_revision_set_fingerprint(active.revision_ids)
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
