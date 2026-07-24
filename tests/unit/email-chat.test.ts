import assert from "node:assert/strict";
import test from "node:test";

import { createEmailService } from "../../lib/email/service";
import { renderReportEmail } from "../../lib/email/templates";
import { createGroundedChatService } from "../../lib/chat/service";

test("report email includes market summary and cited opportunities", () => {
  const html = renderReportEmail({
    title: "VC Intelligence · 23 July 2026",
    marketSummary: "AI infrastructure funding remains active.",
    reportUrl: "https://example.com/reports/report_1",
    opportunities: [{
      companyName: "Ably",
      confidence: "high",
      whyNow: "Infrastructure demand increased.",
      previousContext: "The fund previously passed on timing.",
      nextStep: "Review the company.",
      sources: [{
        id: "source_1",
        provenance: "public_web",
        title: "Q1 2026 AI VC Trends",
        url: "https://example.com/source",
        excerpt: "Infrastructure funding increased.",
      }],
    }],
  });

  assert.match(html, /Market summary/);
  assert.match(html, /AI infrastructure funding remains active/);
  assert.match(html, /Q1 2026 AI VC Trends/);
  assert.doesNotMatch(html, /Low confidence/);
});

test("email service sends through Resend without exposing the API key", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const service = createEmailService({
    apiKey: "re_test_secret",
    from: "VSee <demo@example.com>",
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init });
      return new Response(JSON.stringify({ id: "email_1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const result = await service.send({
    to: "partner@example.com",
    subject: "Report",
    html: "<p>Report</p>",
  });

  assert.equal(result.id, "email_1");
  assert.equal(requests[0].url, "https://api.resend.com/emails");
  assert.doesNotMatch(JSON.stringify(requests[0].init?.body), /re_test_secret/);
});

test("grounded Chat returns insufficient evidence without browsing", async () => {
  let modelCalled = false;
  const chat = createGroundedChatService({
    searchExistingData: async () => [],
    recallMemory: async () => [],
    complete: async () => {
      modelCalled = true;
      return "{}";
    },
  });

  const answer = await chat.answer({
    workspaceId: "demo",
    question: "What happened today to an unknown company?",
    xtraceEnabled: true,
  });

  assert.equal(answer.insufficientEvidence, true);
  assert.equal(answer.citations.length, 0);
  assert.equal(modelCalled, false);
});
