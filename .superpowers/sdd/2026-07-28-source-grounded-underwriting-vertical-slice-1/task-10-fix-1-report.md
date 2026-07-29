# Task 10 Fix 1 Report

## Outcome

Closed all five Important findings and the negative-probability Minor from
`task-10-review.md` without touching Task 7.

## Corrections

1. **Persistable aggregate artifacts**
   - Formula outputs now use the existing strict Task 4 `Calculation` type.
   - Removed the non-schema `outputField` property from persisted objects.
   - Added `evaluateDetailed()` and `evaluateValuationArtifacts()` so one
     execution returns the `ValuationEvaluation`, complete `ScenarioModel`,
     strict `Calculation[]`, and calculation dependency `ClaimEdge[]`.
   - Calculation IDs are deterministic and scoped to the EvidencePack.
   - Tests parse every artifact with `ScenarioModelSchema`,
     `CalculationSchema`, and `ClaimEdgeSchema`, and require every referenced
     calculation ID and lineage endpoint to resolve exactly once.

2. **Benchmark freshness**
   - The engine reads immutable
     `compatible_benchmark_stale_after` benchmark Assumption metadata from the
     EvidencePack and compares it with `pack.asOfDate`.
   - Missing freshness fails closed; expired benchmarks return
     `benchmark_stale` with null scenarios and premium.
   - Completed market-comps calculations retain the expiry Assumption as a
     benchmark input reference.

3. **Currency boundary**
   - Internal formula references preserve unit, currency, and period.
   - Market comps, ownership, Venture Method, and returns require complete,
     mutually compatible USD operands.
   - Missing currency returns `insufficient_input`; EUR or mixed currencies
     return `unsupported_terms` plus a fixed currency blocker.
   - Outputs use the validated input currency rather than hard-coded relabeling.

4. **Scenario multiplier lineage**
   - Market-comps scenario multipliers are consumed only from explicit
     EvidencePack Assumptions with
     `provenanceOrigin = recommended_policy`.
   - Bear/Base/Bull calculation inputs reference the exact multiplier
     Assumption IDs; raw nested Fund Policy values are not formula inputs.

5. **Exact Venture Method dependencies**
   - Each Venture Method `Calculation` contains only its actual direct
     Fact/Assumption/Policy inputs.
   - Calculation-to-calculation dependencies are represented separately with
     typed `ClaimEdge(dependencyType = calculation)` records.
   - The edge graph preserves transitive source lineage without overstating
     direct dependencies.

6. **Probability bounds**
   - Each probability must be within decimal `[0, 1]` before the exact-total
     check.
   - Negative and greater-than-one weights fail; `0`, `1`, and signed zero
     behave correctly.

## TDD Evidence

Focused RED reproduced:

- strict Calculation artifact rejection and missing detailed aggregate;
- stale benchmark accepted by the engine;
- EUR/missing/mixed currencies accepted;
- policy pseudo-IDs used instead of multiplier Assumptions;
- overinclusive Venture Method input refs;
- negative or greater-than-one probabilities accepted.

Focused GREEN:

```text
node --import tsx --test tests/unit/valuation/*.test.ts
```

Result: **23 passed, 0 failed**.

## Verification

- Focused valuation TypeScript: passed.
- Focused valuation ESLint: passed.
- `git diff --check`: passed.

## Remaining concerns

- EvidencePack construction must emit:
  - `compatible_benchmark_value` with its ISO currency in `Assumption.unit`;
  - `compatible_benchmark_stale_after` as an ISO date;
  - one Bear/Base/Bull `scenario_price_multiplier` recommended-policy
    Assumption;
  - currency-bearing ARR assumptions used by the Venture Method.
- Slice 1 remains USD-only and intentionally performs no FX conversion.
