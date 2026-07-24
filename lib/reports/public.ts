import type {
  IntelligenceReportRecord,
} from "../../db/repositories/intelligence";
import { sanitizeReportOpportunities } from "./next-step-policy";

export function toPublicReport(report: IntelligenceReportRecord) {
  return {
    id: report.id,
    workspaceId: report.workspaceId,
    runId: report.runId,
    createdAt: report.createdAt,
    marketSummary: report.marketSummary,
    opportunities: sanitizeReportOpportunities(report.opportunities),
  };
}
