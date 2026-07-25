import assert from "node:assert/strict";
import test from "node:test";

import { buildPreloadedDealMemoryBundles } from "../../lib/corpus/service";
import type { RecallDealContextInput } from "../../lib/xtrace/service";
import {
  dealRecallQuery,
  recallAllDealContexts,
} from "../../worker/recall-deal-contexts";

test("recalls one bounded XTrace query for every MVP Deal", async () => {
  const queries: RecallDealContextInput[] = [];
  const result = await recallAllDealContexts({
    workspaceId: "workspace_demo",
    runId: "00000000-0000-4000-8000-000000000001",
    bundles: buildPreloadedDealMemoryBundles(),
    service: {
      async recallDealContext(input) {
        queries.push(input);
        return [{
          dealId: input.candidateDealIds[0],
          memoryId: `memory_${input.candidateDealIds[0]}`,
          memoryType: "fact",
          text: "Source-backed investment context.",
          score: 0.9,
          provenance: "source_document",
          sourceIds: [`source_${input.candidateDealIds[0]}`],
          fixtureIds: [],
        }];
      },
    },
  });

  assert.equal(queries.length, 19);
  assert.ok(queries.every((query) => query.query.length <= 4_000));
  assert.ok(queries.every((query) => query.candidateDealIds.length === 1));
  assert.ok(queries.every((query) => query.limit === 20));
  assert.equal(result.contextsByDeal.size, 19);
  assert.equal(result.failures.length, 0);
});

test("one failed recall does not suppress the other eighteen Deals", async () => {
  const bundles = buildPreloadedDealMemoryBundles();
  const failedDealId = bundles[0].dealId;
  const result = await recallAllDealContexts({
    workspaceId: "workspace_demo",
    runId: "00000000-0000-4000-8000-000000000001",
    bundles,
    service: {
      async recallDealContext(input) {
        if (input.candidateDealIds[0] === failedDealId) {
          throw new Error("provider secret should not be copied");
        }
        return [{
          dealId: input.candidateDealIds[0],
          memoryId: `memory_${input.candidateDealIds[0]}`,
          memoryType: "fact",
          text: "Source-backed investment context.",
          score: 0.9,
          provenance: "source_document",
          sourceIds: [`source_${input.candidateDealIds[0]}`],
          fixtureIds: [],
        }];
      },
    },
  });

  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].dealId, failedDealId);
  assert.doesNotMatch(result.failures[0].message, /provider secret/i);
  assert.equal(result.contextsByDeal.size, 18);
});

test("recall queries carry each Deal's own decision context, not only template words", () => {
  const bundles = buildPreloadedDealMemoryBundles();
  for (const bundle of bundles) {
    const query = dealRecallQuery(bundle);
    assert.ok(query.length <= 4_000);
    assert.ok(query.includes(bundle.companyName));
    const interaction = bundle.interactions[0];
    if (interaction) {
      assert.ok(
        query.includes(interaction.decisionReason),
        `${bundle.dealId} query must include its decision reason so similarity `
        + "search can rank the Deal's own memories above other Deals' "
        + "template phrasing",
      );
    }
    const fact = bundle.facts[0];
    if (fact) {
      assert.ok(
        query.includes(fact.text.slice(0, 60)),
        `${bundle.dealId} query must include source-backed fact text`,
      );
    }
  }
});

test("missing XTrace service marks every Deal unavailable without local fallback", async () => {
  const result = await recallAllDealContexts({
    workspaceId: "workspace_demo",
    runId: "00000000-0000-4000-8000-000000000001",
    bundles: buildPreloadedDealMemoryBundles(),
  });

  assert.equal(result.contextsByDeal.size, 0);
  assert.equal(result.failures.length, 19);
  assert.ok(result.failures.every((failure) =>
    failure.message === "XTRACE_SERVICE_UNAVAILABLE"
  ));
});
