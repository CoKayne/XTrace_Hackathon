import assert from "node:assert/strict";
import test from "node:test";

import {
  DealStatusSchema,
  MarketEventSchema,
  OpportunityReportItemSchema,
} from "../../lib/contracts/domain";

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
