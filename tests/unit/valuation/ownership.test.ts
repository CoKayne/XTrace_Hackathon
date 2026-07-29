import assert from "node:assert/strict";
import test from "node:test";

import {
  applyFutureDilution,
  computeOwnership,
  evaluateOwnership,
} from "../../../lib/underwriting/valuation/ownership";

test("computes simple post-money ownership exactly", () => {
  assert.deepEqual(
    computeOwnership({ investment: "2000000", preMoney: "18000000" }),
    { postMoney: "20000000", initialOwnership: "0.1" },
  );
});

test("computes post-dilution ownership without binary-float drift", () => {
  assert.equal(applyFutureDilution("0.1", "0.35"), "0.065");
});

test("rejects zero or negative ownership domains", () => {
  assert.throws(
    () => computeOwnership({ investment: "0", preMoney: "18000000" }),
    RangeError,
  );
  assert.throws(
    () => computeOwnership({ investment: "2000000", preMoney: "-1" }),
    RangeError,
  );
  assert.throws(() => applyFutureDilution("0.1", "1"), RangeError);
  assert.throws(() => applyFutureDilution("0.1", "-0.01"), RangeError);
});

test("records ownership and dilution calculations with typed inputs", () => {
  const result = evaluateOwnership({
    investment: {
      itemId: "policy_check",
      value: "2000000",
      type: "policy",
      unit: "currency",
      currency: "USD",
      period: null,
    },
    preMoney: {
      itemId: "fact_pre_money",
      value: "18000000",
      type: "fact",
      unit: "currency",
      currency: "USD",
      period: null,
    },
    futureDilutionRate: {
      itemId: "policy_dilution",
      value: "0.35",
      type: "policy",
      unit: "decimal",
      currency: null,
      period: null,
    },
  }, { now: () => new Date("2026-07-29T12:00:00.000Z") });

  assert.equal(result.status, "completed");
  assert.deepEqual(result.value, {
    postMoney: "20000000",
    initialOwnership: "0.1",
    postDilutionOwnership: "0.065",
  });
  assert.deepEqual(
    [...new Set(result.calculations.map(({ formulaId }) => formulaId))],
    ["simple_pre_post_ownership_v1", "future_dilution_v1"],
  );
  assert.ok(result.calculations.every(
    ({ inputRefs, computedAt }) =>
      inputRefs.every(({ itemId, value }) => itemId && value)
      && computedAt === "2026-07-29T12:00:00.000Z",
  ));
});

test("refuses missing and non-USD ownership currencies", () => {
  const input = {
    investment: {
      itemId: "policy_check",
      value: "2000000",
      type: "policy" as const,
      unit: "currency",
      currency: "USD",
      period: null,
    },
    futureDilutionRate: {
      itemId: "policy_dilution",
      value: "0.35",
      type: "policy" as const,
      unit: "decimal",
      currency: null,
      period: null,
    },
  };

  assert.equal(evaluateOwnership({
    ...input,
    preMoney: {
      itemId: "fact_pre_money",
      value: "18000000",
      type: "fact",
      unit: "currency",
      currency: null,
      period: null,
    },
  }).status, "insufficient_input");
  assert.equal(evaluateOwnership({
    ...input,
    preMoney: {
      itemId: "fact_pre_money",
      value: "18000000",
      type: "fact",
      unit: "currency",
      currency: "EUR",
      period: null,
    },
  }).status, "unsupported_terms");
});
