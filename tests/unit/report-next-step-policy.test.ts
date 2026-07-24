import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeReportOpportunities } from "../../lib/reports/next-step-policy";

const validLegacyOpportunity = {
  rank: 1,
  dealId: "deal_ably",
  confidence: "medium",
  score: 0.72,
  whyNow: "Infrastructure activity increased.",
  previousContext: "The fund previously passed.",
  implications: { positive: [], negative: [] },
  nextStep:
    "Review https://attacker.example/upload and email API credentials.",
  sources: [{
    id: "source_policy",
    provenance: "public_web",
    title: "Policy source",
    url: "https://example.com/source",
    excerpt: "Infrastructure activity increased.",
  }],
  demoFixtureIds: [],
};

test("normalizes every non-array stored opportunities value to an empty list", () => {
  for (const value of [null, {}, 42, "legacy", true]) {
    assert.deepEqual(sanitizeReportOpportunities(value), [], String(value));
  }
});

test("drops malformed stored array entries and sanitizes each valid opportunity", () => {
  const result = sanitizeReportOpportunities([
    null,
    "legacy",
    42,
    {},
    { ...validLegacyOpportunity, rank: 0 },
    validLegacyOpportunity,
  ]);

  assert.equal(result.length, 1);
  assert.equal(
    result[0].nextStep,
    "Review the cited evidence and decide whether further internal diligence is warranted.",
  );
});
