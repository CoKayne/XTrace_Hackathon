# Task 8 Fix Round 1 Independent Re-review

## Verdict

- **Fix acceptance: APPROVED**
- **Residual finding count:** Critical 0 · Important 0 · Minor 0
- **Reviewed commit:** `39603aef6b95a7b42bceb8512f1bc81e4cf2dd69`
- **Reviewed parent:** `54b75c0e4e2407dd93c3166185a1127bd0eb1e0b`
- **Closed:** Task 10 fine-grained Calculation references; Calculation
  lineage persistence/readback; persisted zero-candidate batch completion

The three assigned normal-path blockers are closed. The fix preserves the
candidate lease, workspace scope, atomic finalization, and the Task 10
valuation contract.

## Findings

### Critical

None.

### Important

None.

### Minor

None.

## Required blocker closure

### 1. Task 10 policy and benchmark references — closed

Memory finalization now binds the finalization snapshot to the Fund Policy
snapshot pinned by the candidate's parent batch
(`db/repositories/underwriting-runs.ts:438-459`;
`db/repositories/underwriting-artifacts.ts:538-550`). Its Calculation
reference resolver accepts the exact Task 10 field identities for
`initialCheckMax`, `acceptableFutureDilution`, and the resolved-stage
`grossMoic`/`horizonYears` fields. Benchmark Calculation inputs resolve
through an Evidence Pack Assumption with benchmark provenance, exact
single-pack lineage, and the same value
(`db/repositories/underwriting-artifacts.ts:589-615,675-695`).

The SQL finalizer independently loads the immutable, workspace-scoped Fund
Policy snapshot pinned by the batch, checks each fine-grained policy field
against its stored value, and resolves benchmark inputs through the exact
benchmark Assumption and pinned Benchmark Pack
(`drizzle/0011_underwriting_runs.sql:915-972,1000-1098`). The added owner
permissions are the minimum reads needed for those normal-path checks
(`drizzle/0011_underwriting_runs.sql:1306-1315`).

The committed integration tests finalize the real
`evaluateDetailed()` artifact set in both memory and live PostgreSQL
(`tests/integration/underwriting-finalization.test.ts:604-665,846-916`).
Independent reviewer probes additionally mutated a Task 10 policy reference
and a benchmark-Assumption reference. Memory and PostgreSQL rejected both;
the candidate remained `running`, the active lease remained usable, and no
artifact row survived the SQL failures.

### 2. Calculation claim-edge persistence and readback — closed

`calculationClaimEdges` is now part of both `CandidateFinalization` and the
derived `CandidateArtifactBundle`
(`db/repositories/underwriting-artifacts.ts:57-85`). Memory finalization
parses and retains the field, requires every edge to be
Calculation-to-Calculation with both endpoints in the saved Calculation set,
and includes it in the immutable aggregate claim graph
(`db/repositories/underwriting-artifacts.ts:496-504,635-665,697-715`).

The finalization RPC validates both endpoints and writes every edge into
`underwriting_claim_edges` in the same transaction as the other artifacts
(`drizzle/0011_underwriting_runs.sql:1100-1125`). Supabase readback loads the
workspace-scoped candidate and parent batch, reconstructs Calculation edges
from persisted Calculation identities, revalidates the complete artifact
bundle, and compares the persisted aggregate graph with the reconstructed
graph (`db/repositories/underwriting-artifacts.ts:297-476`).

The committed real-valuation tests retain the Gross MOIC → exit-proceeds and
Gross IRR → Gross MOIC dependencies and verify the live SQL edge count.
Independent probes also proved that an unresolved Calculation endpoint is
rejected atomically in memory and PostgreSQL, and that Supabase readback
returns the complete persisted edge set.

### 3. Persisted zero-candidate batch lifecycle — closed

Memory already terminalizes a batch once selections exist but none remains
selected (`db/repositories/underwriting-runs.ts:153-188`). PostgreSQL now
applies the same rule and refreshes status immediately after selection
persistence (`drizzle/0011_underwriting_runs.sql:367-415,514-565`).

The committed live PostgreSQL test supplies a rank-6 selection, verifies its
normalization to `not_selected|null`, creates no CandidateRun, and observes
batch status `completed`
(`tests/integration/underwriting-finalization.test.ts:918-975`). An
independent memory parity probe exercised the same persisted-selection path
and also observed `completed`.

## Invariant audit

- **Lease:** memory still validates an active worker/token before preparing
  artifacts; SQL still locks the running candidate and validates worker,
  token, and expiry before any insert. Failed reviewer probes retained the
  lease and allowed the unchanged valid payload to finalize.
- **Workspace:** the memory path derives the pinned Fund Policy from the
  candidate's batch. SQL loads both batch and policy with candidate workspace
  constraints. Supabase readback scopes both candidate and batch queries by
  the caller workspace.
- **Atomic finalization:** the official live rollback test and the reviewer
  malformed-reference/edge probes all left zero artifact rows and a running
  candidate after failures that occurred after inserts began.
- **Task 10:** no Task 10 production file changed in this commit. All valuation
  formula/service tests pass, and the actual Task 10 artifact graph crosses
  both persistence implementations.

## Functional-first deferred boundary

The following recorded items remain explicitly deferred and were not used to
reject this normal-path fix:

- `TD-RUN-001`: SECURITY DEFINER owner/membership hardening;
- `TD-RUN-002`: complete direct-RPC malformed-bundle validation parity;
- `TD-RUN-003`: concurrent batch create-or-reuse recovery;
- `TD-RUN-004`: duplicate-identity fingerprint ordering.

The reviewed diff does not newly break a normal path through any of these
deferred areas.

## Scope audit

Commit `39603ae` changes only:

- `db/repositories/underwriting-artifacts.ts`
- `db/repositories/underwriting-runs.ts`
- `drizzle/0011_underwriting_runs.sql`
- `tests/integration/underwriting-finalization.test.ts`
- `task-8-fix-1-report.md`

The review itself was performed in an isolated detached clone so concurrent
Task 11b/12 working-tree changes were not part of the verdict.

## Fresh verification

Official focused Task 8 plus all Task 10 valuation tests, with PostgreSQL
required (no gated skips):

```text
env REQUIRE_POSTGRES_MIGRATION_TESTS=1 node --import tsx --test \
  tests/unit/underwriting-fingerprints.test.ts \
  tests/unit/underwriting-runs.test.ts \
  tests/integration/underwriting-finalization.test.ts \
  tests/unit/valuation/market-comps.test.ts \
  tests/unit/valuation/ownership.test.ts \
  tests/unit/valuation/returns.test.ts \
  tests/unit/valuation/service.test.ts \
  tests/unit/valuation/venture-method.test.ts

44 passed, 0 failed, 0 skipped
```

Serialized live migration and Task 8 integration suite:

```text
env REQUIRE_POSTGRES_MIGRATION_TESTS=1 node --import tsx --test \
  --test-concurrency=1 \
  tests/integration/workspace-composite-migration.test.ts \
  tests/integration/schema-migrations.test.ts \
  tests/integration/underwriting-finalization.test.ts

17 passed, 0 failed, 0 skipped
```

Reviewer-only mutation/readback probes in a disposable clone:

```text
wrong policy ref rejection
wrong benchmark-Assumption ref rejection
unresolved Calculation edge rollback
complete Supabase Calculation-edge readback
memory persisted zero-candidate completion

5 passed, 0 failed, 0 skipped
```

Additional fresh checks:

```text
npm run typecheck
→ passed

npm run lint
→ passed

git diff --check 39603ae^ 39603ae
→ passed
```

No product code was edited during this review.
