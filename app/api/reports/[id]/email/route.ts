import { z } from "zod";

import { getIntelligenceRepository } from "../../../../../db/repositories/intelligence";
import { errorResponse, jsonError, jsonOk } from "../../../../../lib/api/response";
import {
  isAllowedReportRecipient,
  rateLimitRequest,
} from "../../../../../lib/api/safety";
import { createEmailService } from "../../../../../lib/email/service";
import { renderReportEmail } from "../../../../../lib/email/templates";
import { buildDemoViewModel } from "../../../../../lib/demo/view-model";
import { toPublicReport } from "../../../../../lib/reports/public";

const EmailRequestSchema = z.object({
  recipient: z.string().email().optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const rate = await rateLimitRequest(request, "report-email", 3, 10 * 60_000);
  if (!rate.allowed) {
    return jsonError(
      "RATE_LIMITED",
      `Too many email attempts. Try again in ${rate.retryAfterSeconds} seconds.`,
      429,
      true,
    );
  }
  const { id } = await context.params;
  const repository = getIntelligenceRepository();
  const report = await repository.getReport(id);
  if (!report) return jsonError("NOT_FOUND", `Report ${id} was not found`, 404);
  try {
    const requested = EmailRequestSchema.parse(await request.json());
    const recipient = requested.recipient ?? process.env.REPORT_TO_EMAIL;
    if (!recipient) {
      return jsonError(
        "INTEGRATION_UNAVAILABLE",
        "No report recipient is configured.",
        503,
      );
    }
    if (!isAllowedReportRecipient(recipient)) {
      return jsonError(
        "VALIDATION_ERROR",
        "That recipient is not enabled for this public demo.",
        400,
      );
    }
    const claimedReport = await repository.claimReportDelivery(id, recipient);
    if (!claimedReport) {
      return jsonError(
        "CONFLICT",
        "This report is already being delivered or has already been sent.",
        409,
      );
    }
    const deals = new Map(buildDemoViewModel().deals.map((deal) => [deal.id, deal]));
    const appUrl = process.env.PUBLIC_APP_URL ?? new URL(request.url).origin;
    const html = renderReportEmail({
      title: `VSee intelligence · ${new Date(claimedReport.createdAt).toLocaleDateString("en-US")}`,
      marketSummary: claimedReport.marketSummary,
      reportUrl: `${appUrl}/?view=reports&report=${encodeURIComponent(claimedReport.id)}`,
      opportunities: claimedReport.opportunities.map((opportunity) => ({
        companyName: deals.get(opportunity.dealId)?.companyName ?? opportunity.dealId,
        confidence: opportunity.confidence,
        whyNow: opportunity.whyNow,
        previousContext: opportunity.previousContext,
        implications: opportunity.implications,
        nextStep: opportunity.nextStep,
        sources: opportunity.sources.map((source) => (
          source.documentId && !source.url
            ? { ...source, url: `${appUrl}/api/documents/${encodeURIComponent(source.documentId)}/access` }
            : source
        )),
      })),
    });
    try {
      const delivery = await createEmailService().send({
        to: recipient,
        subject: "VSee · Deals worth a second look",
        html,
        idempotencyKey: `report-${id}`,
      });
      const updated = await repository.updateReportDelivery(id, {
        status: "sent",
        recipient,
        providerMessageId: delivery.id,
        sentAt: new Date().toISOString(),
      });
      return jsonOk(toPublicReport(updated));
    } catch (sendError) {
      await repository.updateReportDelivery(id, {
        status: "failed",
        recipient,
        error: sendError instanceof Error ? sendError.message : "Email failed",
      });
      throw sendError;
    }
  } catch (error) {
    return errorResponse(error);
  }
}
