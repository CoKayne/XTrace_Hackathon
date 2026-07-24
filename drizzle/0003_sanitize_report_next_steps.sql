begin;

with rewritten_reports as (
  select
    report.id,
    jsonb_agg(
      case
        when opportunity.value ->> 'nextStep' in (
          'Review the cited evidence and decide whether to continue internal screening.',
          'Review the cited evidence and decide whether to update the watchlist status.',
          'Review the cited evidence and decide whether to update ongoing internal diligence.',
          'Review the cited evidence and decide whether to reopen internal diligence.',
          'Review the cited evidence and decide whether to update portfolio monitoring.',
          'Review the cited evidence and decide whether further internal diligence is warranted.'
        )
        then opportunity.value
        when jsonb_typeof(opportunity.value) = 'object'
        then jsonb_set(
          opportunity.value,
          '{nextStep}',
          to_jsonb(
            'Review the cited evidence and decide whether further internal diligence is warranted.'::text
          ),
          true
        )
        else jsonb_build_object(
          'nextStep',
          'Review the cited evidence and decide whether further internal diligence is warranted.'
        )
      end
      order by opportunity.position
    ) as opportunities
  from public.intelligence_reports as report
  cross join lateral jsonb_array_elements(report.opportunities)
    with ordinality as opportunity(value, position)
  where jsonb_typeof(report.opportunities) = 'array'
  group by report.id
)
update public.intelligence_reports as report
set opportunities = rewritten.opportunities
from rewritten_reports as rewritten
where report.id = rewritten.id
  and report.opportunities is distinct from rewritten.opportunities;

commit;
