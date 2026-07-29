import assert from "node:assert/strict";
import test from "node:test";

import {
  computeGrossReturns,
  evaluateGrossReturns,
} from "../../../lib/underwriting/valuation/returns";

test("computes gross MOIC and annualized IRR", () => {
  const result = computeGrossReturns({
    invested: "2000000",
    proceeds: "10000000",
    holdingYears: "5",
  });

  assert.equal(result.moic, "5");
  assert.equal(result.irrRoundedForDisplay, "0.3797");
  assert.ok(!("netMoic" in result));
  assert.ok(!("netIrr" in result));
});

test("rejects zero and negative return domains", () => {
  assert.throws(
    () => computeGrossReturns({
      invested: "0",
      proceeds: "10000000",
      holdingYears: "5",
    }),
    RangeError,
  );
  assert.throws(
    () => computeGrossReturns({
      invested: "2000000",
      proceeds: "-1",
      holdingYears: "5",
    }),
    RangeError,
  );
  assert.throws(
    () => computeGrossReturns({
      invested: "2000000",
      proceeds: "10000000",
      holdingYears: "0",
    }),
    RangeError,
  );
});

test("records separate gross MOIC and annualized gross IRR calculations", () => {
  const result = evaluateGrossReturns({
    invested: {
      itemId: "policy_check",
      value: "2000000",
      type: "policy",
      unit: "currency",
      currency: "USD",
      period: null,
    },
    proceeds: {
      itemId: "calculation_exit_proceeds",
      value: "10000000",
      type: "assumption",
      unit: "currency",
      currency: "USD",
      period: null,
    },
    holdingYears: {
      itemId: "policy_horizon",
      value: "5",
      type: "policy",
      unit: "years",
      currency: null,
      period: null,
    },
  }, { now: () => new Date("2026-07-29T12:00:00.000Z") });

  assert.equal(result.status, "completed");
  assert.equal(result.value?.moic, "5");
  assert.equal(result.value?.irrRoundedForDisplay, "0.3797");
  assert.deepEqual(
    result.calculations.map(({ formulaId }) => formulaId),
    ["gross_deal_moic_v1", "annualized_gross_irr_v1"],
  );
});
