# Task 8 Fix Round 1 Report

Date: 2026-07-29
Scope: functional-first end-to-end blockers only

## Result

This fix closes the three normal-path integration blockers assigned for Task 8:

1. Real Task 10 valuation Calculations can cross the memory and PostgreSQL
   finalization boundary with their field-level Fund Policy references and
   benchmark Assumption references intact.
2. `calculationClaimEdges` are accepted, validated, persisted, returned, and
   included in the immutable aggregate claim graph.
3. A batch with persisted selections but no Top-5 candidates reaches the
   terminal `completed` state in both memory and PostgreSQL.

## RED evidence

The new integration tests were run before implementation.

- Memory finalization rejected the real `evaluateDetailed()` output with:
  `Every calculation input must resolve to persisted evidence or a version reference.`
- PostgreSQL rejected the same artifact set with:
  `Calculation input benchmark_seed (benchmark) does not resolve`.
- PostgreSQL left the zero-candidate batch as `queued` instead of
  `completed`.

## Implementation

### Task 10 reference compatibility

- Candidate finalization now binds `versionSnapshot.fundPolicyId` to the
  exact Fund Policy snapshot pinned by the parent batch.
- Calculation policy inputs accept the exact Task 10 field identities:
  - `policy:initialCheckMax`
  - `policy:acceptableFutureDilution`
  - `policy:returnTargets.<resolved-stage>.grossMoic`
  - `policy:returnTargets.<resolved-stage>.horizonYears`
- PostgreSQL resolves those fields against the immutable, workspace-scoped
  `fund_policy_versions.values` payload and requires the referenced value to
  equal the Calculation input value.
- Benchmark Calculation inputs resolve through the exact benchmark
  Assumption in the Evidence Pack. The Assumption must:
  - have benchmark provenance;
  - have the same value as the Calculation input; and
  - contain exactly `[versionSnapshot.benchmarkPackId]` as its pack lineage.
- PostgreSQL additionally requires the pinned benchmark pack to exist.

### Calculation graph persistence

- `CandidateFinalization` and `CandidateArtifactBundle` now include
  `calculationClaimEdges`.
- Every calculation edge must use `dependencyType = calculation` and both
  endpoints must resolve to saved Calculations.
- Memory persistence retains the exact edge set.
- The finalization RPC writes the edges atomically to
  `underwriting_claim_edges`.
- Supabase readback separates calculation-to-calculation edges from judgment
  and decision edges, reconstructs the finalization bundle, and verifies the
  complete persisted aggregate graph.

### Zero-candidate lifecycle

- PostgreSQL now mirrors memory behavior:
  - no selections yet: retain the current batch state;
  - persisted selections exist, none remain selected, and no candidates
    exist: mark the batch `completed`.
- Selection persistence refreshes the batch state immediately instead of
  requiring a later candidate-creation call.

## Verification

Focused Task 8 plus valuation suite:

```text
44 tests
41 passed
0 failed
3 PostgreSQL-gated tests skipped
```

Live PostgreSQL migration and integration suites (serialized because the
temporary databases share cluster-level test roles):

```text
17 passed
0 failed
0 skipped
```

Full TypeScript typecheck and ESLint:

```text
typecheck passed
0 errors
```

`git diff --check`:

```text
passed
```

## Explicitly deferred

This fix does not change or claim closure for:

- `TD-RUN-001`: SECURITY DEFINER owner and membership hardening;
- `TD-RUN-002`: complete direct-RPC malformed-bundle validation parity;
- `TD-RUN-003`: concurrent batch create-or-reuse race;
- `TD-RUN-004`: duplicate-identity fingerprint ordering.

Those items remain recorded in
`docs/technical-debt/2026-07-29-end-to-end-deferred-hardening.md`.
