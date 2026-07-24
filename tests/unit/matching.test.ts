import assert from "node:assert/strict";
import test from "node:test";

import {
  confidenceForScore,
  rankQualifiedMatches,
  weightedOpportunityScore,
} from "../../lib/matching/scoring";
import { createMatchingService } from "../../lib/matching/service";

test("keeps at most five medium-or-high confidence matches", () => {
  const matches = [
    { id: "a", score: 0.90 },
    { id: "b", score: 0.40 },
    { id: "c", score: 0.70 },
    { id: "d", score: 0.60 },
    { id: "e", score: 0.80 },
    { id: "f", score: 0.59 },
    { id: "g", score: 0.58 },
  ];

  const result = rankQualifiedMatches(matches);
  assert.equal(result.length, 5);
  assert.equal(result.some((item) => item.id === "b"), false);
  assert.deepEqual(result.map((item) => item.score), [0.9, 0.8, 0.7, 0.6, 0.59]);
  assert.equal(result[0].confidence, "high");
});

test("uses the approved weighted score and confidence boundaries", () => {
  assert.equal(weightedOpportunityScore({
    eventRelevance: 1,
    dealRelevance: 1,
    priorContextStrength: 1,
    evidenceQuality: 1,
  }), 1);
  assert.equal(confidenceForScore(0.78), "high");
  assert.equal(confidenceForScore(0.58), "medium");
  assert.equal(confidenceForScore(0.579), "low");
});

test("drops unsupported claims and retains explicit fixture lineage", async () => {
  const service = createMatchingService({
    reason: async () => [{
      dealId: "deal_1",
      whyNow: "AI infrastructure funding increased. Unsupported customer claim.",
      previousContext: "The fund passed because timing was early.",
      positiveImplications: ["Market timing improved."],
      negativeImplications: ["Competition increased."],
      nextStep: "Review the company.",
      citedSourceIds: ["market_1", "missing_source"],
      demoFixtureIds: ["fixture_1"],
      scoreInputs: {
        eventRelevance: 0.9,
        dealRelevance: 0.8,
        priorContextStrength: 0.8,
        evidenceQuality: 0.9,
      },
      claimSourceIds: {
        "AI infrastructure funding increased.": ["market_1"],
        "Unsupported customer claim.": ["missing_source"],
      },
    }],
  });

  const result = await service.match({
    deals: [{ id: "deal_1", companyName: "Ably", status: "passed" }],
    events: [],
    memoryContexts: [],
    sources: [{
      id: "market_1",
      provenance: "public_web",
      title: "Market source",
      url: "https://example.com/market",
      excerpt: "Funding increased.",
    }],
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].whyNow, "AI infrastructure funding increased.");
  assert.deepEqual(result[0].demoFixtureIds, ["fixture_1"]);
  assert.deepEqual(result[0].sources.map((source) => source.id), ["market_1"]);
});
