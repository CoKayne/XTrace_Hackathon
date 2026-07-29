# Task 10 Report: Deterministic Slice-1 Valuation

## Outcome

Implemented the six approved deterministic Slice-1 formulas using decimal
strings throughout:

- `market_comps_v1`
- `venture_return_method_v1`
- `simple_pre_post_ownership_v1`
- `future_dilution_v1`
- `gross_deal_moic_v1`
- `annualized_gross_irr_v1`

The engine produces exactly Bear, Base, and Bull scenarios, preserves the
complete ScenarioInput field set, records source/assumption lineage, leaves
unknown values null with an explicit reason, and fails closed for stale or
incompatible benchmarks, unsupported terms, missing inputs, and invalid
domains. It emits gross deal-level MOIC/IRR only; it contains no net fund,
SAFE/note, option-pool, waterfall, DCF, or FX model.

## Files

Created:

- `lib/underwriting/valuation/contracts.ts`
- `lib/underwriting/valuation/scenarios.ts`
- `lib/underwriting/valuation/market-comps.ts`
- `lib/underwriting/valuation/venture-method.ts`
- `lib/underwriting/valuation/ownership.ts`
- `lib/underwriting/valuation/returns.ts`
- `lib/underwriting/valuation/service.ts`
- `tests/unit/valuation/market-comps.test.ts`
- `tests/unit/valuation/venture-method.test.ts`
- `tests/unit/valuation/ownership.test.ts`
- `tests/unit/valuation/returns.test.ts`
- `tests/unit/valuation/service.test.ts`

## TDD Evidence

Initial RED:

```text
node --import tsx --test tests/unit/valuation/*.test.ts
```

Result: all five suites failed on the expected missing valuation modules.

Second RED:

- ownership tests failed because `evaluateOwnership` did not exist;
- returns tests failed because `evaluateGrossReturns` did not exist;
- the end-to-end valuation test remained partial because ownership and return
  calculation lineage was not wired.

Focused GREEN:

```text
node --import tsx --test tests/unit/valuation/*.test.ts
```

Result: **17 passed, 0 failed**.

## Verification

- Focused valuation TypeScript command: passed.
- `npm run lint`: passed with zero errors.
- `git diff --check`: passed.
- Full-repository `npm run typecheck` was attempted, but concurrent uncommitted
  Task 7 tests import reference-registry modules that do not exist yet. The
  reported errors were confined to those Task 7 files; the focused Task 10
  TypeScript command passed.

## Self-Review

- Hand-calculated literals cover exact ownership, dilution, VC Method,
  pricing premium, MOIC, and display-rounded IRR.
- Financial arithmetic never uses JavaScript `Number`; authoritative values
  stay as normalized decimal strings and half-even rounding is display-only.
- Every completed CalculationResult records formula/version, typed input IDs
  and values, output identity/value, unit, currency, period, rounding policy,
  status, and computed time.
- Market comps accept only exact or broad-compatible cohorts and preserve
  Bear ≤ Base ≤ Bull.
- A valuation whose pre/post basis is unknown supports pricing comparison but
  not ownership or return math.
- Scenario modeling defaults to unweighted. If weighting is enabled, all
  three probabilities must exist and total exactly `1`.
- Missing scenario inputs are never omitted or converted to zero.
- The public ValuationEvaluation contains no net fund return fields.

## Concerns

- Task 10 consumes a compatible benchmark as a benchmark-provenance
  Assumption inside the EvidencePack. Task 7/9 must preserve that field
  (`compatible_benchmark_value`) when resolving and building the pack.
- Slice 1 intentionally computes ownership only from an explicitly known
  pre-money company valuation. Unknown-basis asks remain pricing-only, and
  unsupported financing terms return `unsupported_terms`.
- The full repository typecheck should be rerun after the concurrent Task 7
  reference modules are present.
