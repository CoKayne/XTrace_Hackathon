import {
  OpportunityReportItemSchema,
  type DealStatus,
  type OpportunityReportItem,
} from "../contracts/domain";

export const SAFE_REPORT_NEXT_STEP_FALLBACK =
  "Review the cited evidence and decide whether further internal diligence is warranted.";

const NEXT_STEP_BY_STATUS = {
  screening:
    "Review the cited evidence and decide whether to continue internal screening.",
  watchlist:
    "Review the cited evidence and decide whether to update the watchlist status.",
  evaluating:
    "Review the cited evidence and decide whether to update ongoing internal diligence.",
  passed:
    "Review the cited evidence and decide whether to reopen internal diligence.",
  invested:
    "Review the cited evidence and decide whether to update portfolio monitoring.",
} satisfies Record<DealStatus, string>;

const SAFE_REPORT_NEXT_STEPS = new Set<string>([
  ...Object.values(NEXT_STEP_BY_STATUS),
  SAFE_REPORT_NEXT_STEP_FALLBACK,
]);

export function nextStepForDealStatus(status: DealStatus): string {
  return NEXT_STEP_BY_STATUS[status];
}

export function sanitizeReportNextStep(value: string): string {
  return SAFE_REPORT_NEXT_STEPS.has(value)
    ? value
    : SAFE_REPORT_NEXT_STEP_FALLBACK;
}

export function sanitizeReportOpportunities(
  opportunities: unknown,
): OpportunityReportItem[] {
  if (!Array.isArray(opportunities)) return [];
  return opportunities.flatMap((value) => {
    const parsed = OpportunityReportItemSchema.safeParse(value);
    return parsed.success
      ? [{
          ...parsed.data,
          nextStep: sanitizeReportNextStep(parsed.data.nextStep),
        }]
      : [];
  });
}
