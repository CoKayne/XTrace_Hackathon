begin;

with rewritten_reports as (
  select
    report.id,
    coalesce(
      (
        select jsonb_agg(
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
            else jsonb_set(
              opportunity.value,
              '{nextStep}',
              to_jsonb(
                'Review the cited evidence and decide whether further internal diligence is warranted.'::text
              ),
              true
            )
          end
          order by opportunity.position
        )
        from jsonb_array_elements(
          case
            when jsonb_typeof(report.opportunities) = 'array'
            then report.opportunities
            else '[]'::jsonb
          end
        ) with ordinality as opportunity(value, position)
        where jsonb_typeof(opportunity.value) = 'object'
          and jsonb_typeof(opportunity.value -> 'nextStep') = 'string'
      ),
      '[]'::jsonb
    ) as opportunities
  from public.intelligence_reports as report
)
update public.intelligence_reports as report
set opportunities = rewritten.opportunities
from rewritten_reports as rewritten
where report.id = rewritten.id
  and report.opportunities is distinct from rewritten.opportunities;

commit;
