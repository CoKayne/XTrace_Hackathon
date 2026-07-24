import type { DealStatus } from "../contracts/domain";

export function decisionReasonLabel(status: DealStatus): string {
  if (status === "passed") return "Pass reason";
  if (status === "invested") return "Investment rationale";
  return "Decision reason";
}
