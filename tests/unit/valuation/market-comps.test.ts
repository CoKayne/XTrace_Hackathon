import assert from "node:assert/strict";
import test from "node:test";

import { evaluateMarketComps } from "../../../lib/underwriting/valuation/market-comps";

const ref = (
  itemId: string,
  value: string,
  type: "fact" | "assumption" | "policy" | "benchmark",
  currency: string | null = null,
) => ({ itemId, value, type, unit: null, currency, period: null });

test("computes ordered Bear, Base, and Bull market comps and pricing premium", () => {
  const result = evaluateMarketComps({
    benchmarkValue: ref("benchmark_seed", "20000000", "benchmark", "USD"),
    currentReportedValuation: ref(
      "fact_current_ask",
      "25000000",
      "fact",
      "USD",
    ),
    compatibility: "exact",
    stale: false,
    multipliers: {
      bear: ref("policy_bear", "0.75", "policy"),
      base: ref("policy_base", "1", "policy"),
      bull: ref("policy_bull", "1.25", "policy"),
    },
  }, { now: () => new Date("2026-07-29T12:00:00.000Z") });

  assert.equal(result.status, "completed");
  assert.deepEqual(result.scenarios, {
    bear: "15000000",
    base: "20000000",
    bull: "25000000",
  });
  assert.equal(result.pricingPremium, "0.25");
  assert.ok(
    Number(result.scenarios.bear) <= Number(result.scenarios.base)
      && Number(result.scenarios.base) <= Number(result.scenarios.bull),
  );
  assert.equal(result.calculations.length, 4);
  for (const calculation of result.calculations) {
    assert.equal(calculation.formulaId, "market_comps_v1");
    assert.equal(calculation.formulaVersion, "1");
    assert.equal(calculation.roundingPolicy, "half_even_display_only");
    assert.equal(calculation.computedAt, "2026-07-29T12:00:00.000Z");
    assert.ok(calculation.inputRefs.every((input) => input.itemId.length > 0));
  }
});

test("fails closed for stale and mismatched benchmarks", () => {
  const base = {
    benchmarkValue: ref("benchmark_seed", "20000000", "benchmark", "USD"),
    currentReportedValuation: ref(
      "fact_current_ask",
      "25000000",
      "fact",
      "USD",
    ),
    multipliers: {
      bear: ref("policy_bear", "0.75", "policy"),
      base: ref("policy_base", "1", "policy"),
      bull: ref("policy_bull", "1.25", "policy"),
    },
  } as const;

  assert.equal(evaluateMarketComps({
    ...base,
    compatibility: "exact",
    stale: true,
  }).status, "stale_benchmark");
  assert.equal(evaluateMarketComps({
    ...base,
    compatibility: "adjacent_only",
    stale: false,
  }).status, "not_applicable");
  assert.deepEqual(evaluateMarketComps({
    ...base,
    compatibility: "unavailable",
    stale: false,
  }).scenarios, { bear: null, base: null, bull: null });
});

test("unknown benchmark never becomes zero", () => {
  const result = evaluateMarketComps({
    benchmarkValue: null,
    currentReportedValuation: ref(
      "fact_current_ask",
      "25000000",
      "fact",
      "USD",
    ),
    compatibility: "exact",
    stale: false,
    multipliers: {
      bear: ref("policy_bear", "0.75", "policy"),
      base: ref("policy_base", "1", "policy"),
      bull: ref("policy_bull", "1.25", "policy"),
    },
  });

  assert.equal(result.status, "insufficient_input");
  assert.deepEqual(result.scenarios, { bear: null, base: null, bull: null });
  assert.equal(result.pricingPremium, null);
});

test("fails closed when pricing currencies are missing or incompatible", () => {
  const multipliers = {
    bear: ref("multiplier_bear", "0.75", "assumption"),
    base: ref("multiplier_base", "1", "assumption"),
    bull: ref("multiplier_bull", "1.25", "assumption"),
  };

  const missing = evaluateMarketComps({
    benchmarkValue: ref("benchmark_seed", "20000000", "benchmark"),
    currentReportedValuation: ref(
      "fact_current_ask",
      "25000000",
      "fact",
      "USD",
    ),
    compatibility: "exact",
    stale: false,
    multipliers,
  });
  assert.equal(missing.status, "insufficient_input");
  assert.ok(missing.blockerCodes.includes("benchmark_currency_missing"));

  const mixed = evaluateMarketComps({
    benchmarkValue: ref("benchmark_seed", "20000000", "benchmark", "EUR"),
    currentReportedValuation: ref(
      "fact_current_ask",
      "25000000",
      "fact",
      "USD",
    ),
    compatibility: "exact",
    stale: false,
    multipliers,
  });
  assert.equal(mixed.status, "unsupported_terms");
  assert.deepEqual(mixed.scenarios, {
    bear: null,
    base: null,
    bull: null,
  });
});
