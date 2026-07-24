import assert from "node:assert/strict";
import test from "node:test";

import {
  CompanyAnalysisSchema,
  DealStatusSchema,
  EvidenceFieldSchema,
  MarketEventSchema,
  OpportunityReportItemSchema,
} from "../../lib/contracts/domain";

function companyAnalysisFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const source = {
    id: "source_1",
    provenance: "source_document",
    title: "7bridges pitch deck",
    documentId: "document_1",
    page: 1,
    excerpt: "7bridges provides logistics orchestration software.",
  };

  return {
    id: "analysis_1",
    reportId: "report_1",
    runId: "00000000-0000-4000-8000-000000000001",
    dealId: "deal_7bridges",
    companyName: "7bridges",
    dealStatus: "passed",
    outcome: "no_material_change",
    confidence: "low",
    score: 0.21,
    verifiedSourceCount: 1,
    investmentMemory: {
      previousMeetingSummary: "The team presented its logistics platform.",
      decisionReason: "The fund passed pending stronger enterprise adoption.",
      concerns: ["Enterprise adoption was not yet demonstrated."],
      revisitConditions: ["Revisit after measurable enterprise adoption."],
      lastEvaluatedAt: "2026-01-12T12:00:00.000Z",
      memoryIds: ["memory_1"],
      sourceIds: ["source_1"],
      fixtureIds: ["interaction_1"],
    },
    marketEvidence: {
      relationship: "none",
      explanation:
        "No material market evidence matched this company during the current 14-day scan.",
      eventIds: [],
      events: [],
      sourceIds: [],
    },
    implications: {
      positive: [],
      negative: [],
    },
    recommendedNextMove:
      "No immediate follow-up recommended. Continue monitoring.",
    companyBrief: {
      icSnapshot: [{
        label: "Company",
        value: "7bridges",
        unavailableReason: null,
        sourceIds: ["source_1"],
      }],
      traction: [{
        label: "ARR",
        value: null,
        unavailableReason: "Not available in current evidence",
        sourceIds: [],
      }],
      dealTerms: [{
        label: "Round",
        value: null,
        unavailableReason: "Not available in current evidence",
        sourceIds: [],
      }],
      risks: [{
        severity: "medium",
        title: "Enterprise adoption",
        detail: "Enterprise adoption was not yet demonstrated.",
        nextQuestion: "Has enterprise adoption materially improved?",
        sourceIds: ["source_1"],
      }],
      decisionHistory: [{
        occurredAt: "2026-01-12T12:00:00.000Z",
        title: "Initial review",
        summary: "The fund passed pending stronger enterprise adoption.",
        sourceIds: ["source_1"],
      }],
      sourceLineage: [source],
    },
    sources: [source],
    createdAt: "2026-07-24T12:00:00.000Z",
    ...overrides,
  };
}

test("normalizes the legacy interested status to watchlist", () => {
  assert.equal(DealStatusSchema.parse("interested"), "watchlist");
});

test("rejects a public market event without evidence", () => {
  assert.throws(() => MarketEventSchema.parse({
    id: "event_1",
    title: "New market event",
    eventType: "funding",
    sectors: ["ai"],
    themes: ["inference"],
    summary: "Capital moved.",
    positiveImplications: [],
    negativeImplications: [],
    publishedAt: "2026-07-23T12:00:00.000Z",
    confidence: "medium",
    sources: [],
  }));
});

test("rejects low-confidence opportunity reports", () => {
  assert.throws(() => OpportunityReportItemSchema.parse({
    rank: 1,
    dealId: "deal_1",
    confidence: "low",
    score: 0.4,
    whyNow: "A market changed.",
    previousContext: "The Deal was reviewed.",
    implications: { positive: [], negative: [] },
    nextStep: "Review the evidence.",
    sources: [{
      id: "source_1",
      provenance: "public_web",
      title: "Example",
      url: "https://example.com",
      excerpt: "Evidence.",
    }],
    demoFixtureIds: [],
  }));
});

test("accepts a source-grounded no-change company analysis", () => {
  const parsed = CompanyAnalysisSchema.parse(companyAnalysisFixture());

  assert.equal(parsed.companyName, "7bridges");
  assert.equal(parsed.outcome, "no_material_change");
  assert.equal(parsed.companyBrief.traction[0].value, null);
  assert.equal(
    parsed.companyBrief.traction[0].unavailableReason,
    "Not available in current evidence",
  );
});

test("rejects a displayed evidence value without source ids", () => {
  const fixture = companyAnalysisFixture();
  const companyBrief = fixture.companyBrief as Record<string, unknown>;

  assert.throws(() => CompanyAnalysisSchema.parse({
    ...fixture,
    companyBrief: {
      ...companyBrief,
      traction: [{
        label: "ARR",
        value: "$2.4M",
        unavailableReason: null,
        sourceIds: [],
      }],
    },
  }));
});

test("rejects unavailable evidence fields that also contain a value", () => {
  assert.throws(() => EvidenceFieldSchema.parse({
    label: "ARR",
    value: "$2.4M",
    unavailableReason: "Not available in current evidence",
    sourceIds: ["source_1"],
  }));
});

test("rejects a belief revision with low confidence", () => {
  assert.throws(() => CompanyAnalysisSchema.parse(companyAnalysisFixture({
    outcome: "belief_revised",
    confidence: "low",
  })));
});

test("rejects market evidence that cites a source outside the analysis lineage", () => {
  assert.throws(() => CompanyAnalysisSchema.parse(companyAnalysisFixture({
    outcome: "monitor",
    marketEvidence: {
      relationship: "related",
      explanation: "A related market event was detected.",
      eventIds: ["event_1"],
      events: [{
        id: "event_1",
        title: "Logistics software funding increased",
        eventType: "funding",
        publishedAt: "2026-07-23T12:00:00.000Z",
        sourceIds: ["unknown_source"],
      }],
      sourceIds: ["unknown_source"],
    },
  })));
});
