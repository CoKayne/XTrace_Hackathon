import type {
  IntelligenceReportRecord,
} from "../../db/repositories/intelligence";

export function toPublicReport(report: IntelligenceReportRecord) {
  return {
    id: report.id,
    workspaceId: report.workspaceId,
    runId: report.runId,
    createdAt: report.createdAt,
    marketSummary: report.marketSummary,
    opportunities: report.opportunities,
  };
}
