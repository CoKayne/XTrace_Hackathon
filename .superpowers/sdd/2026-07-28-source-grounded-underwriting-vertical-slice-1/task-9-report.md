# Task 9 Report — Source-grounded Evidence Pack and Context Router

## Outcome

Implemented the sole Evidence Pack input boundary and deterministic Context
Router for Vertical Slice 1.

The implementation now:

- normalizes currency, decimal rates, periods, and metric definitions before
  comparison;
- keeps ARR, revenue, pipeline, GMV, recurring revenue, services revenue, and
  pass-through revenue as distinct fields;
- preserves management-reported and independently verified Facts separately;
- creates versioned materiality conflicts without selecting the more favorable
  value;
- blocks only critical material open conflicts;
- applies Router precedence `confirmed > source_explicit > derived`;
- returns `needs_confirmation` for ambiguous primary context fields instead of
  selecting a nearby cohort;
- returns `underwriting_status = unavailable` when company identity is absent;
- applies an `Advance` ceiling when round-price evidence is missing;
- preserves Core-only analysis for unsupported contexts, with an `Advance`
  ceiling;
- rejects XTrace recalled text that cannot resolve to exact local source
  revision lineage;
- persists an immutable `SavedEvidencePack` containing the exact EvidencePack,
  canonical input fingerprint, and full source revision snapshots;
- emits valuation-compatible benchmark value and expiry Assumptions, exactly
  Bear/Base/Bull recommended-policy price multipliers, and currency-bearing
  ARR/revenue scenario Assumptions when a single accepted source Fact exists.

## Persistence boundary

Task 9 deliberately exposes an `EvidencePacksRepository` adapter seam and a
memory implementation. It does not guess a PostgreSQL table or RPC owned by
Task 8.

The handoff record is:

```ts
interface SavedEvidencePack {
  pack: EvidencePack;
  inputFingerprint: string;
  sourceRevisionSnapshots: SourceRevision[];
}
```

Task 8 candidate finalization remains responsible for atomic PostgreSQL
persistence. The Task 9 fingerprint includes the exact source revision
snapshots, normalized Facts, generated Assumptions, conflicts, XTrace lineage
snapshot, resolved context, critical profile, and materiality rules.

## TDD evidence

Focused RED:

```text
node --import tsx --test tests/unit/evidence-normalization.test.ts \
  tests/unit/evidence-pack.test.ts tests/unit/router-critical-evidence.test.ts \
  tests/integration/evidence-pack-provenance.test.ts
```

Result before implementation: **4 test files failed** because the Task 9
repository, builder, normalization, conflict, and router modules did not exist.

Focused GREEN after the minimal implementation:

```text
14 passed, 0 failed
```

## Verification

Task 9-only TypeScript compile:

```text
PASS
```

Task 9-only ESLint:

```text
PASS
```

Relevant evidence-contract, underwriting-contract, valuation, and Task 9
suite:

```text
66 passed, 0 failed
```

Whitespace/diff validation for Task 9 files:

```text
PASS
```

The repository-wide `npm run typecheck` could not be used as a clean Task 9
signal during parallel execution because concurrent Task 8 RED tests already
imported `underwriting-runs` and `underwriting-artifacts` modules that had not
yet been created. No diagnostic referenced a Task 9 file; the explicit
Task 9-only TypeScript compile passed.

## Self-review

- Source revision IDs are resolved through `SourceRegistry` before any Fact is
  accepted.
- XTrace memory IDs without local revision lineage fail closed.
- Reordered source and lineage ID arrays produce the same canonical
  fingerprint.
- A repeated build with identical immutable inputs reuses one saved pack.
- Material ARR conflicts suppress ARR scenario assumptions instead of choosing
  either reported or verified value.
- Benchmark Assumptions reference the resolved immutable benchmark pack and
  carry an ISO currency / calendar-valid expiry.
- No Task 8 migration, table, RPC, or finalization file was modified.
