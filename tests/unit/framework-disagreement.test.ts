import assert from "node:assert/strict";
import test from "node:test";

import type {
  FrameworkJudgment,
} from "../../lib/contracts/underwriting";
import {
  buildFrameworkDisagreements,
} from "../../lib/underwriting/frameworks/disagreements";
import { SYNTHETIC_FRAMEWORK_PACK } from "../../seed/underwriting/framework-pack-v1";

const marketCard = SYNTHETIC_FRAMEWORK_PACK.cards[0]!;
const valuationCard = SYNTHETIC_FRAMEWORK_PACK.cards[7]!;

function judgment(input: {
  id: string;
  cardId: string;
  conclusion: "supportive" | "negative";
  supportIds: string[];
  counterIds: string[];
}): FrameworkJudgment {
  return {
    id: input.id,
    analysisType: "framework_judgment",
    frameworkCardId: input.cardId,
    frameworkVersion: "1",
    applicability: "applicable",
    conclusion: input.conclusion,
    supportEvidenceItemIds: input.supportIds,
    counterEvidenceItemIds: input.counterIds,
    unusedEvidenceItemIds: [],
    strongestSupport: "Grounded strongest support.",
    strongestCounterargument: "Grounded strongest counterargument.",
    unknowns: ["One material unknown remains."],
    limitations: ["Synthetic framework fixture only."],
    confidence: {
      sourceReliability: "medium",
      evidenceStrength: "medium",
      evidenceCoverage: "medium",
      applicability: "high",
      judgment: "medium",
    },
    claimEdges: [],
    fingerprint: `sha256:${input.id}`,
  };
}

test("preserves opposing company-quality and price judgments as one deterministic disagreement", () => {
  const companyQuality = judgment({
    id: "judgment_company_quality",
    cardId: marketCard.id,
    conclusion: "supportive",
    supportIds: ["fact_market"],
    counterIds: ["fact_adoption_unknown"],
  });
  const price = judgment({
    id: "judgment_price",
    cardId: valuationCard.id,
    conclusion: "negative",
    supportIds: ["calculation_pricing_premium"],
    counterIds: ["assumption_benchmark"],
  });
  const original = structuredClone([companyQuality, price]);

  const forward = buildFrameworkDisagreements({
    judgments: [companyQuality, price],
    cards: [marketCard, valuationCard],
  });
  const reversed = buildFrameworkDisagreements({
    judgments: [price, companyQuality],
    cards: [valuationCard, marketCard],
  });

  assert.deepEqual(forward, reversed);
  assert.deepEqual([companyQuality, price], original);
  assert.equal(forward.length, 1);
  assert.deepEqual(
    {
      leftJudgmentId: forward[0]?.leftJudgmentId,
      rightJudgmentId: forward[0]?.rightJudgmentId,
      topic: forward[0]?.topic,
      evidenceItemIds: forward[0]?.evidenceItemIds,
    },
    {
      leftJudgmentId: companyQuality.id,
      rightJudgmentId: price.id,
      topic: "company_quality_vs_price",
      evidenceItemIds: [
        "assumption_benchmark",
        "calculation_pricing_premium",
        "fact_adoption_unknown",
        "fact_market",
      ],
    },
  );
  assert.match(forward[0]?.explanation ?? "", /supportive/i);
  assert.match(forward[0]?.explanation ?? "", /negative/i);
  assert.doesNotMatch(forward[0]?.explanation ?? "", /average|blended score/i);
});
