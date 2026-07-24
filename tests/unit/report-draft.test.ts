import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFullDraftText,
  buildInternalReportDraft,
} from "../../lib/reports/draft";

const report = {
  id: "report_1",
  createdAt: "2026-07-24T17:30:00.000Z",
  marketSummary: "AI infrastructure funding accelerated during the 14-day window.",
  opportunities: [{
    rank: 1,
    dealId: "deal_ably",
    confidence: "high" as const,
    score: 0.87,
    whyNow: "Infrastructure demand increased.",
    previousContext: "The fund previously passed because the timing was early.",
    implications: {
      positive: ["The addressable market may expand."],
      negative: ["Competition may increase."],
    },
    nextStep: "Review the source evidence and decide whether to reconnect.",
    sources: [
      {
        id: "public_1",
        provenance: "public_web" as const,
        title: "Funding announcement",
        url: "https://news.example/funding",
        page: 2,
        excerpt: "Funding activity increased.",
      },
      {
        id: "document_1",
        provenance: "source_document" as const,
        title: "Ably pitch deck",
        documentId: "doc ably",
        page: 4,
        excerpt: "Ably provides realtime infrastructure.",
      },
    ],
    demoFixtureIds: ["fixture_1"],
  }],
};

test("builds a cited internal VC report draft without a recipient", () => {
  const draft = buildInternalReportDraft({
    report,
    companyNames: { deal_ably: "Ably" },
    appOrigin: "https://vsee.example/",
  });

  assert.equal(draft.subject, "VSee · Deals worth a second look — 2026-07-24");
  assert.match(draft.bodyText, /14-DAY MARKET SUMMARY/);
  assert.match(draft.bodyText, /#1 · ABLY · HIGH CONFIDENCE · 87%/);
  assert.match(draft.bodyText, /Why now:\nInfrastructure demand increased/);
  assert.match(draft.bodyText, /Potential positive effects/);
  assert.match(draft.bodyText, /Potential negative effects/);
  assert.match(draft.bodyText, /https:\/\/news\.example\/funding#page=2/);
  assert.match(
    draft.bodyText,
    /https:\/\/vsee\.example\/api\/documents\/doc%20ably\/access#page=4/,
  );
  assert.match(draft.bodyText, /https:\/\/vsee\.example\/\?view=reports&report=report_1/);
  assert.doesNotMatch(`${draft.subject}\n${draft.bodyText}`, /^To:/m);
  assert.doesNotMatch(draft.bodyText, /Hi founder|outreach/i);
});

test("keeps a zero-match market report truthful", () => {
  const draft = buildInternalReportDraft({
    report: { ...report, opportunities: [] },
    companyNames: {},
    appOrigin: "https://vsee.example",
  });

  assert.match(draft.bodyText, /No medium- or high-confidence Deal overlap was found/);
});

test("copies the full draft as subject followed by body", () => {
  assert.equal(
    buildFullDraftText({ subject: "Subject line", bodyText: "Message body" }),
    "Subject: Subject line\n\nMessage body",
  );
});
