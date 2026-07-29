# Task 10 Fix 3 Report

## Scope

This fix closes the single residual Important finding from
`task-10-fix-2-review.md`. It changes only the deterministic valuation service
and its unit tests.

## Behavior fixed

Market-comps valuation now requires one atomic benchmark pair:

- exactly one `compatible_benchmark_value`;
- exactly one `compatible_benchmark_stale_after`;
- both use scenario `all`;
- both have `provenanceOrigin = "benchmark"`;
- both have exactly one `inputRefId`;
- that reference is the exact non-null
  `ResolvedUnderwritingContext.benchmarkPackId`.

If any condition fails, the pair resolves to unavailable. Market-comps
scenarios and pricing premium remain `null`, and the valuation result contains
the explicit `benchmark_pair_invalid` blocker.

This rejects missing candidates, duplicate candidates, wrong provenance,
wrong-pack references, mixed-pack pairs, ambiguous multi-pack references, and
a missing resolved benchmark pack.

## TDD evidence

The regression tests were added before production code. Against the prior
implementation, the targeted run failed:

```text
node --import tsx --test \
  --test-name-pattern='benchmark value and expiry|benchmark freshness that is not' \
  tests/unit/valuation/service.test.ts

tests 2
pass 0
fail 2

missing resolved benchmark pack:
actual scenarios = ["15000000", "20000000", "25000000"]
expected scenarios = [null, null, null]
```

After the service change, the same targeted run passed:

```text
tests 2
pass 2
fail 0
```

## Files changed

- `lib/underwriting/valuation/service.ts`
- `tests/unit/valuation/service.test.ts`
- this report

No Task 8 or Task 9 production files were changed or staged.

## Verification

```text
node --import tsx --test tests/unit/valuation/*.test.ts
→ 27 passed, 0 failed

npm run typecheck
→ passed

npm run lint -- --quiet
→ passed

git diff --check -- \
  lib/underwriting/valuation/service.ts \
  tests/unit/valuation/service.test.ts
→ passed
```
