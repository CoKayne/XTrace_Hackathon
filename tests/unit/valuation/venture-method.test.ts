import assert from "node:assert/strict";
import test from "node:test";

import { evaluateVentureMethod } from "../../../lib/underwriting/valuation/venture-method";

const ref = (
  itemId: string,
  value: string,
  type: "fact" | "assumption" | "policy" | "benchmark",
  currency: string | null = null,
) => ({ itemId, value, type, unit: null, currency, period: null });

test("computes the VC Method maximum acceptable entry value", () => {
  const result = evaluateVentureMethod({
    terms: "simple_pre_money_preferred",
    investment: ref("policy_check", "2000000", "policy", "USD"),
    targetGrossMoic: ref("policy_target_moic", "5", "policy"),
    exitArr: ref(
      "assumption_exit_arr",
      "20000000",
      "assumption",
      "USD",
    ),
    exitArrMultiple: ref("assumption_exit_multiple", "5", "assumption"),
    futureDilutionRate: ref("policy_dilution", "0.5", "policy"),
  }, {
    now: () => new Date("2026-07-29T12:00:00.000Z"),
    calculationScope: "venture_test",
  });

  assert.equal(result.status, "completed");
  assert.deepEqual(result.value, {
    exitEquityValue: "100000000",
    requiredExitProceeds: "10000000",
    requiredPostDilutionOwnership: "0.1",
    requiredInitialOwnership: "0.2",
    maximumAcceptablePostMoney: "10000000",
    maximumAcceptablePreMoney: "8000000",
  });
  assert.equal(result.calculations.length, 6);
  assert.ok(result.calculations.every(
    (calculation) =>
      calculation.formulaId === "venture_return_method_v1"
      && calculation.status === "completed",
  ));
  const byOutput = new Map(result.calculations.map((calculation) => [
    calculation.id.split(":").at(-1),
    calculation,
  ]));
  assert.deepEqual(
    byOutput.get("exit_equity_value")?.inputRefs.map(({ itemId }) => itemId),
    ["assumption_exit_arr", "assumption_exit_multiple"],
  );
  assert.deepEqual(
    byOutput.get("required_exit_proceeds")?.inputRefs.map(
      ({ itemId }) => itemId,
    ),
    ["policy_check", "policy_target_moic"],
  );
  assert.deepEqual(
    byOutput.get("required_post_dilution_ownership")?.inputRefs,
    [],
  );
  assert.deepEqual(
    byOutput.get("required_initial_ownership")?.inputRefs.map(
      ({ itemId }) => itemId,
    ),
    ["policy_dilution"],
  );
  assert.deepEqual(
    byOutput.get("maximum_acceptable_post_money")?.inputRefs.map(
      ({ itemId }) => itemId,
    ),
    ["policy_check"],
  );
  assert.deepEqual(
    byOutput.get("maximum_acceptable_pre_money")?.inputRefs.map(
      ({ itemId }) => itemId,
    ),
    ["policy_check"],
  );
  assert.deepEqual(
    result.claimEdges.map((edge) => ({
      claim: edge.claimItemId.split(":").at(-1),
      dependency: edge.dependencyItemId.split(":").at(-1),
      type: edge.dependencyType,
    })),
    [
      {
        claim: "required_post_dilution_ownership",
        dependency: "required_exit_proceeds",
        type: "calculation",
      },
      {
        claim: "required_post_dilution_ownership",
        dependency: "exit_equity_value",
        type: "calculation",
      },
      {
        claim: "required_initial_ownership",
        dependency: "required_post_dilution_ownership",
        type: "calculation",
      },
      {
        claim: "maximum_acceptable_post_money",
        dependency: "required_initial_ownership",
        type: "calculation",
      },
      {
        claim: "maximum_acceptable_pre_money",
        dependency: "maximum_acceptable_post_money",
        type: "calculation",
      },
    ],
  );
});

test("returns unsupported_terms instead of modeling SAFE or note conversion", () => {
  const result = evaluateVentureMethod({
    terms: "safe",
    investment: ref("policy_check", "2000000", "policy", "USD"),
    targetGrossMoic: ref("policy_target_moic", "5", "policy"),
    exitArr: ref(
      "assumption_exit_arr",
      "20000000",
      "assumption",
      "USD",
    ),
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
    investment: ref("policy_check", "2000000", "policy", "USD"),
    targetGrossMoic: ref("policy_target_moic", "5", "policy"),
    exitArr: ref("assumption_exit_arr", "0", "assumption", "USD"),
    exitArrMultiple: ref("assumption_exit_multiple", "5", "assumption"),
    futureDilutionRate: ref("policy_dilution", "1", "policy"),
  });

  assert.equal(result.status, "invalid_domain");
  assert.equal(result.value, null);
});
