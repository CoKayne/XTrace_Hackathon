import assert from "node:assert/strict";
import test from "node:test";

import type { DealMemoryBundle, MarketEvent } from "../../lib/contracts/domain";
import {
  buildMatchingSources,
  buildStructuredMemoryContexts,
} from "../../lib/matching/context";
import { createClaudeMatchingReasoner } from "../../lib/matching/claude-reasoner";

const bundle: DealMemoryBundle = {
  dealId: "deal_ably",
  companyName: "Ably",
  status: "passed",
  facts: [{
    text: "Ably provides realtime data infrastructure.",
    sources: [{
      id: "deal_source",
      provenance: "source_document",
      title: "Ably deck",
      documentId: "doc_ably",
      page: 5,
      excerpt: "Realtime communication at the edge.",
    }],
  }],
  interactions: [{
    id: "fixture_ably",
    occurredAt: "2026-07-01T00:00:00.000Z",
    summary: "Synthetic pass note.",
    concerns: ["Timing"],
    revisitConditions: ["Relevant market change"],
    provenance: "demo_fixture",
    label: "Synthetic VC decision record created for the hackathon demo",
  }],
};

const event: MarketEvent = {
  id: "event_1",
  title: "Realtime infrastructure announcement",
  eventType: "announcement",
  sectors: ["infrastructure"],
  themes: ["realtime"],
  summary: "A source-backed market event.",
  positiveImplications: [],
  negativeImplications: [],
  publishedAt: "2026-07-20T00:00:00.000Z",
  confidence: "medium",
  sources: [{
    id: "market_source",
    provenance: "public_web",
    title: "Official announcement",
    url: "https://example.com/announcement",
    publishedAt: "2026-07-20T00:00:00.000Z",
    excerpt: "The announcement concerns realtime infrastructure.",
  }],
};

test("structured matching context preserves source and synthetic-fixture lineage", () => {
  const contexts = buildStructuredMemoryContexts([bundle]);
  assert.deepEqual(contexts[0].sourceIds, ["deal_source"]);
  assert.deepEqual(contexts[0].fixtureIds, ["fixture_ably"]);
  assert.match(contexts[0].text, /Synthetic VC decision record/i);

  const sources = buildMatchingSources([bundle], [event]);
  assert.deepEqual(sources.map((source) => source.id).sort(), [
    "deal_source",
    "fixture_ably",
    "market_source",
  ]);
});

test("Claude matching reasoner parses JSON and rejects Deals outside the candidate set", async () => {
  const calls: string[] = [];
  const reasoner = createClaudeMatchingReasoner({
    async complete(input) {
      calls.push(`${input.system}\n${input.messages[0].content}`);
      return `\`\`\`json
      [
        {
          "dealId": "deal_ably",
          "whyNow": "The official announcement concerns realtime infrastructure.",
          "previousContext": "The synthetic record says the fund passed.",
          "positiveImplications": ["The event overlaps the supplied company description."],
          "negativeImplications": [],
          "nextStep": "Review the cited source and decide whether to follow up.",
          "citedSourceIds": ["market_source", "deal_source"],
          "demoFixtureIds": ["fixture_ably"],
          "scoreInputs": {
            "eventRelevance": 0.8,
            "dealRelevance": 0.8,
            "priorContextStrength": 0.7,
            "evidenceQuality": 0.8
          },
          "claimSourceIds": {
            "The official announcement concerns realtime infrastructure.": ["market_source"]
          }
        },
        {
          "dealId": "deal_unknown",
          "whyNow": "Unknown.",
          "previousContext": "Unknown.",
          "positiveImplications": [],
          "negativeImplications": [],
          "nextStep": "None.",
          "citedSourceIds": ["market_source"],
          "demoFixtureIds": [],
          "scoreInputs": {
            "eventRelevance": 1,
            "dealRelevance": 1,
            "priorContextStrength": 1,
            "evidenceQuality": 1
          },
          "claimSourceIds": {
            "Unknown.": ["market_source"]
          }
        }
      ]\`\`\``;
    },
  });

  const result = await reasoner.reason({
    deals: [{ id: "deal_ably", companyName: "Ably", status: "passed" }],
    events: [event],
    memoryContexts: buildStructuredMemoryContexts([bundle]),
    sources: buildMatchingSources([bundle], [event]),
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0], /Do not invent company progress/i);
  assert.deepEqual(result.map((item) => item.dealId), ["deal_ably"]);
});
