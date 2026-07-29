import assert from "node:assert/strict";
import test from "node:test";

import { evaluateVentureMethod } from "../../../lib/underwriting/valuation/venture-method";

const ref = (
  itemId: string,
  value: string,
  type: "fact" | "assumption" | "policy" | "benchmark",
) => ({ itemId, value, type });

test("computes the VC Method maximum acceptable entry value", () => {
  const result = evaluateVentureMethod({
    terms: "simple_pre_money_preferred",
    investment: ref("policy_check", "2000000", "policy"),
    targetGrossMoic: ref("policy_target_moic", "5", "policy"),
    exitArr: ref("assumption_exit_arr", "20000000", "assumption"),
    exitArrMultiple: ref("assumption_exit_multiple", "5", "assumption"),
    futureDilutionRate: ref("policy_dilution", "0.5", "policy"),
  }, { now: () => new Date("2026-07-29T12:00:00.000Z") });

  assert.equal(result.status, "completed");
  assert.deepEqual(result.value, {
    exitEquityValue: "100000000",
    requiredExitProceeds: "10000000",
    requiredPostDilutionOwnership: "0.1",
    requiredInitialOwnership: "0.2",
    maximumAcceptablePostMoney: "10000000",
    maximumAcceptablePreMoney: "8000000",
  });
  assert.ok(result.calculations.length > 0);
  assert.ok(result.calculations.every(
    (calculation) =>
      calculation.formulaId === "venture_return_method_v1"
      && calculation.status === "completed",
  ));
});

test("returns unsupported_terms instead of modeling SAFE or note conversion", () => {
  const result = evaluateVentureMethod({
    terms: "safe",
    investment: ref("policy_check", "2000000", "policy"),
    targetGrossMoic: ref("policy_target_moic", "5", "policy"),
    exitArr: ref("assumption_exit_arr", "20000000", "assumption"),
    exitArrMultiple: ref("assumption_exit_multiple", "5", "assumption"),
    futureDilutionRate: ref("policy_dilution", "0.5", "policy"),
  });

  assert.equal(result.status, "unsupported_terms");
  assert.equal(result.value, null);
  assert.deepEqual(result.calculations, []);
});

test("returns explicit invalid_domain for impossible VC Method inputs", () => {
  const result = evaluateVentureMethod({
    terms: "simple_pre_money_preferred",
    investment: ref("policy_check", "2000000", "policy"),
    targetGrossMoic: ref("policy_target_moic", "5", "policy"),
    exitArr: ref("assumption_exit_arr", "0", "assumption"),
    exitArrMultiple: ref("assumption_exit_multiple", "5", "assumption"),
    futureDilutionRate: ref("policy_dilution", "1", "policy"),
  });

  assert.equal(result.status, "invalid_domain");
  assert.equal(result.value, null);
});
