begin;

-- Rename the demo-fixture disclosure label. The disclosure itself is
-- mandatory; only the wording changes.

alter table public.deal_interactions
  drop constraint if exists deal_interactions_demo_fixture_label_check;

update public.deal_interactions
set label = 'Sample decision record'
where label = 'Synthetic VC decision record created for the hackathon demo';

update public.deal_interactions
set meeting_summary = replace(
  meeting_summary,
  'Synthetic internal note:',
  'Sample internal note:'
)
where meeting_summary like 'Synthetic internal note:%';

alter table public.deal_interactions
  add constraint deal_interactions_demo_fixture_label_check
  check (label = 'Sample decision record');

commit;

notify pgrst, 'reload schema';
