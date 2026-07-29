# Task 10 Fix 2 Report

## Outcome

Closed the two residual Important findings from
`task-10-fix-1-review.md` without touching Task 8 or Task 9.

## Corrections

### Benchmark freshness provenance and calendar validity

- `compatible_benchmark_stale_after` is now selected only from an Assumption
  whose `provenanceOrigin` is `benchmark`.
- The candidate as-of date and benchmark expiry must both pass Zod's exact ISO
  calendar-date validation.
- A recommended-policy expiry, February 30, or an out-of-range month/day is
  treated as missing freshness and fails closed before market-comps values are
  produced.
- The existing valid-current and valid-stale behavior is unchanged.

### Persisted exit-proceeds and exact return lineage

- Added an internal typed Calculation output reference so a computed value is
  not mislabeled as an Assumption.
- `exit_proceeds` is now persisted as a strict `Calculation` under
  `gross_deal_moic_v1`.
- Its ClaimEdges point to the saved Venture Method `exit_equity_value` and
  ownership `post_dilution_ownership` calculations.
- Gross MOIC now has only its direct Policy input and a Calculation edge to
  `exit_proceeds`; the flattened ARR, exit-multiple, current-valuation, and
  dilution refs were removed.
- Gross IRR retains only holding years as its direct Policy input and its
  Calculation edge to Gross MOIC.
- Every new ClaimEdge endpoint resolves to an actual Calculation in the
  detailed aggregate.

## TDD evidence

Focused RED was run before production changes:

```text
node --import tsx --test tests/unit/valuation/service.test.ts
```

Result: **8 passed, 3 failed**. The three expected failures proved that:

1. a non-benchmark expiry still produced Bear/Base/Bull values;
2. calendar-invalid expiry dates still produced values;
3. no persisted `exit_proceeds` Calculation existed.

After the minimal implementation, the same service suite passed:

```text
11 passed, 0 failed
```

The final valuation suite contains **26 tests**, including exact direct
Calculation inputs and dependency IDs for exit proceeds, Gross MOIC, and Gross
IRR.

## Scope

Production changes are limited to:

- `lib/underwriting/valuation/contracts.ts`
- `lib/underwriting/valuation/returns.ts`
- `lib/underwriting/valuation/service.ts`

Test changes are limited to:

- `tests/unit/valuation/service.test.ts`

No Task 8 or Task 9 implementation, test, fixture, or report file changed.

## Verification

The final pre-commit verification runs:

```text
node --import tsx --test tests/unit/valuation/*.test.ts
npm run typecheck
npm run lint -- --quiet
git diff --check
```

All completed successfully.
