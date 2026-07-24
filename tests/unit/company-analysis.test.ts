import assert from "node:assert/strict";
import test from "node:test";

import type {
  DealMemoryBundle,
  SourceRef,
} from "../../lib/contracts/domain";
import { buildPreloadedDealMemoryBundles } from "../../lib/corpus/service";
import type { GroundedMatch } from "../../lib/matching/service";
import {
  buildCompanyAnalyses,
  countCompanyAnalyses,
} from "../../lib/reports/company-analysis";
import type { MemoryContext } from "../../lib/xtrace/service";

const REPORT_ID = "report_1";
const RUN_ID = "00000000-0000-4000-8000-000000000001";
const CREATED_AT = "2026-07-24T12:00:00.000Z";

function contextsForEveryDeal(
  bundles: DealMemoryBundle[],
): Map<string, MemoryContext[]> {
  return new Map(bundles.map((bundle) => [
    bundle.dealId,
    [{
      dealId: bundle.dealId,
      memoryId: `memory_${bundle.dealId}`,
      memoryType: "fact",
      text: `Verified investment memory for ${bundle.companyName}.`,
      score: 0.9,
      provenance: "source_document",
      sourceIds: bundle.facts.flatMap((fact) =>
        fact.sources.map((source) => source.id)
      ),
      fixtureIds: bundle.interactions.map((interaction) => interaction.id),
    }],
  ]));
}

function fixtureSource(bundle: DealMemoryBundle): SourceRef {
  const interaction = bundle.interactions[0];
  return {
    id: interaction.id,
    provenance: "demo_fixture",
    title: interaction.label,
    excerpt: [
      interaction.label,
      interaction.summary,
      `Decision reason: ${interaction.decisionReason}`,
      `Concerns: ${interaction.concerns.join(" ") || "None recorded."}`,
      `Revisit conditions: ${
        interaction.revisitConditions.join(" ") || "None recorded."
      }`,
    ].join(". "),
  };
}

function groundedMatch(
  bundle: DealMemoryBundle,
  confidence: GroundedMatch["confidence"],
): GroundedMatch {
  const marketSource: SourceRef = {
    id: `market_${bundle.dealId}`,
    provenance: "public_web",
    title: `${bundle.companyName} market evidence`,
    url: `https://example.com/${bundle.dealId}`,
    publisher: "Example",
    publishedAt: "2026-07-23T12:00:00.000Z",
    excerpt: `${bundle.companyName} sector activity increased.`,
  };
  const dealSource = bundle.facts[0].sources[0];
  const syntheticSource = fixtureSource(bundle);
  const score = confidence === "high" ? 0.82 : confidence === "medium"
    ? 0.65
    : 0.42;
  return {
    dealId: bundle.dealId,
    confidence,
    score,
    whyNow: marketSource.excerpt,
    previousContext: bundle.interactions[0].decisionReason,
    implications: {
      positive: ["The market evidence warrants renewed internal review."],
      negative: [],
    },
    nextStep:
      "Review the cited evidence and decide whether further internal diligence is warranted.",
    relationship: "satisfies",
    events: [{
      id: `event_${bundle.dealId}`,
      title: marketSource.title,
      eventType: "funding",
      publishedAt: "2026-07-23T12:00:00.000Z",
      sourceIds: [marketSource.id],
    }],
    sources: [marketSource, dealSource, syntheticSource],
    demoFixtureIds: [syntheticSource.id],
  };
}

function baseInput() {
  const bundles = buildPreloadedDealMemoryBundles();
  return {
    reportId: REPORT_ID,
    runId: RUN_ID,
    createdAt: CREATED_AT,
    bundles,
    contextsByDeal: contextsForEveryDeal(bundles),
    recallFailures: new Set<string>(),
    groundedMatches: [] as GroundedMatch[],
  };
}

test("builds one no-change analysis for every fixed MVP Deal", () => {
  const analyses = buildCompanyAnalyses(baseInput());

  assert.equal(analyses.length, 19);
  assert.ok(analyses.every((analysis) =>
    analysis.outcome === "no_material_change"
  ));
  assert.deepEqual(countCompanyAnalyses(analyses), {
    companyCount: 19,
    beliefRevised: 0,
    monitor: 0,
    noMaterialChange: 19,
    analysisUnavailable: 0,
  });
});

test("projects qualified and low grounded matches without inventing fields", () => {
  const input = baseInput();
  const highBundle = input.bundles.find((bundle) =>
    bundle.dealId === "deal_ably"
  )!;
  const lowBundle = input.bundles.find((bundle) =>
    bundle.dealId === "deal_100plus"
  )!;
  const analyses = buildCompanyAnalyses({
    ...input,
    groundedMatches: [
      groundedMatch(highBundle, "high"),
      groundedMatch(lowBundle, "low"),
    ],
  });
  const byDeal = new Map(analyses.map((analysis) => [
    analysis.dealId,
    analysis,
  ]));

  assert.equal(byDeal.get("deal_ably")?.outcome, "belief_revised");
  assert.equal(byDeal.get("deal_100plus")?.outcome, "monitor");
  assert.equal(
    byDeal.get("deal_ably")?.companyBrief.traction[0].value,
    null,
  );
  assert.equal(
    byDeal.get("deal_ably")?.companyBrief.traction[0].unavailableReason,
    "Not available in current evidence",
  );
});

test("uses analysis unavailable only for the failed company recall", () => {
  const input = baseInput();
  const analyses = buildCompanyAnalyses({
    ...input,
    recallFailures: new Set(["deal_7bridges"]),
  });
  const unavailable = analyses.filter((analysis) =>
    analysis.outcome === "analysis_unavailable"
  );

  assert.equal(unavailable.length, 1);
  assert.equal(unavailable[0].dealId, "deal_7bridges");
  assert.equal(unavailable[0].sources.length, 0);
});

test("treats an empty XTrace result as unavailable instead of using local fallback", () => {
  const input = baseInput();
  input.contextsByDeal.set("deal_7bridges", []);
  const analyses = buildCompanyAnalyses(input);

  assert.equal(
    analyses.find((analysis) => analysis.dealId === "deal_7bridges")?.outcome,
    "analysis_unavailable",
  );
});

test("extracts only exact source-backed sparse traction values", () => {
  const input = baseInput();
  const analyses = buildCompanyAnalyses(input);
  const couPro = analyses.find((analysis) =>
    analysis.dealId === "deal_coupro"
  )!;
  const users = couPro.companyBrief.traction.find((field) =>
    field.label === "Customers / users"
  );
  const growth = couPro.companyBrief.traction.find((field) =>
    field.label === "Growth"
  );

  assert.equal(users?.value, "500+ users");
  assert.equal(growth?.value, "10% merchant revenue gains");
  assert.ok(users?.sourceIds.length);
  assert.ok(growth?.sourceIds.length);
});
