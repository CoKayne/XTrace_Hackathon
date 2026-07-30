# Task 13 Fix Round 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make source-grounded underwriting temporally correct, replay-stable, reference-pinned, provider-budgeted, resumable, and database-exact while preserving the approved target-safe claim path.

**Architecture:** Reference repositories return as-of-valid immutable definitions with canonical digests. Candidate grounding derives lineage capture identity from the persisted CompanyAnalysis snapshot, and candidate/batch/version identities pin effective reference digests. Stage checkpoints persist exact input fingerprints, replayable outputs, and per-stage usage; provider attempts reserve budget at the actual Claude-call boundary. Migration `0012` enforces immutable reference children and byte-exact source snapshots.

**Tech Stack:** TypeScript, Node test runner, Zod, PostgreSQL/PLpgSQL, Supabase PostgREST, Drizzle schema.

## Global Constraints

- Preserve C3 exact workspace-and-candidate claim behavior.
- Do not modify Task11b or Task12 behavior.
- Do not add Task14/15 UI or API scope.
- Every production behavior change begins with an observed adversarial RED test.
- Framework exhaustion or timeout is visible unavailability/truncation, never negative evidence or an opaque candidate failure.
- Published reference definitions and source revisions are immutable and pinned by canonical SHA-256 digests.

---

### Task 1: As-of references and immutable Critical Evidence definitions

**Files:**
- Modify: `db/repositories/underwriting-references.ts`
- Modify: `lib/underwriting/evidence/builder.ts`
- Modify: `lib/underwriting/router.ts`
- Modify: `tests/unit/underwriting-references.test.ts`
- Modify: `tests/unit/evidence-pack.test.ts`
- Modify: `tests/integration/underwriting-finalization.test.ts`
- Modify: `drizzle/0012_source_grounded_underwriting.sql`

**Interfaces:**
- Produces: `CriticalEvidenceProfile.definitionFingerprint`.
- Produces: `SelectedBenchmarkInput` with `entryId`, `version`, `effectiveAt`, `staleAfter`, and `definitionFingerprint`.

- [x] **Step 1: Write failing temporal and immutability tests**

```ts
assert.equal(await repository.getSelectedBenchmark({
  packId,
  stage: "seed",
  asOfDate: "2030-01-01",
}), null);
await assert.rejects(
  builder.build({ ...input, asOfDate: "2030-01-01", benchmark: stale }),
  /benchmark.*as-of|stale/i,
);
```

Add a live PostgreSQL mutation probe that updates one
`critical_evidence_profile_fields` row and expects
`critical_evidence_profile_fields is immutable`.

- [x] **Step 2: Run RED**

Run:
`node --import tsx --test --test-name-pattern='2030|immutable Critical Evidence' tests/unit/underwriting-references.test.ts tests/unit/evidence-pack.test.ts tests/integration/underwriting-finalization.test.ts`

Expected: stale benchmark is returned, builder accepts it, and live row mutation succeeds.

- [x] **Step 3: Implement as-of selection and immutable digests**

Filter Supabase entries with `effective_at=lte.<asOfDate>`, reject a future
pack retrieval date and `asOfDate > staleAfter`, mirror the same dates in
memory, and validate `effectiveAt <= asOfDate <= staleAfter` in the builder.
Canonicalize full profile/benchmark definitions with `canonicalJson()` and
attach `sha256:` digests. Install the existing immutable-reference trigger
on the child table and grant only `select` to runtime roles.

- [x] **Step 4: Run GREEN**

Run the command from Step 2 plus the complete reference/evidence suites.

### Task 2: Stable grounding identity and real forced-rerun alias

**Files:**
- Modify: `lib/underwriting/candidate-grounding.ts`
- Modify: `lib/underwriting/orchestrator.ts`
- Modify: `lib/underwriting/fingerprints.ts`
- Modify: `db/repositories/underwriting-artifacts.ts`
- Modify: `tests/integration/evidence-pack-provenance.test.ts`
- Modify: `tests/integration/process-run-underwriting.test.ts`

**Interfaces:**
- Produces: lineage `capturedAt` pinned to `CompanyAnalysis.createdAt`.
- Produces: candidate/version snapshot reference fingerprints.

- [x] **Step 1: Write failing deterministic build and real rerun tests**

```ts
const first = await grounding.buildEvidencePack(sourceGroundedInput);
clock.advance(1_000);
const second = await grounding.buildEvidencePack(sourceGroundedInput);
assert.equal(second.id, first.id);
```

Run an ordinary and forced source-grounded orchestration with the same
repository and assert one canonical artifact bundle plus a completed alias.

- [x] **Step 2: Run RED**

Expected: Evidence Pack IDs differ and forced refresh creates a second
canonical fingerprint/artifact set.

- [x] **Step 3: Implement stable lineage and reference identity**

Replace runtime `now()` capture with the persisted analysis timestamp.
Include exact Critical Evidence, Benchmark, valuation, decision, framework,
and catalog definition digests in orchestration/candidate fingerprints and
`CandidateVersionSnapshotSchema`.

- [x] **Step 4: Run GREEN**

Run the two new tests plus fingerprint/finalization suites.

### Task 3: Actual provider-attempt budget and safe lens truncation

**Files:**
- Modify: `lib/underwriting/orchestrator.ts`
- Create: `lib/underwriting/candidate-stage-runtime.ts`
- Modify: `lib/underwriting/frameworks/service.ts`
- Modify: `lib/underwriting/frameworks/claude-lens.ts`
- Modify: `tests/unit/framework-lens.test.ts`
- Modify: `tests/integration/process-run-underwriting.test.ts`

**Interfaces:**
- Produces: `CandidateStageRuntime.runProviderAttempt()`.
- Consumes: a callback before every Claude initial or repair request.

- [x] **Step 1: Write failing provider-capacity and timeout tests**

Exercise eight applicable cards and assert usage is `8 * 4_000`, then force
one repair and assert another `4_000`. Configure a five-millisecond framework
timeout and assert persisted truncation/unavailable reasons rather than
candidate `failed`.

- [x] **Step 2: Run RED**

Expected: usage reports `4_000` total and timeout marks the candidate failed.

- [x] **Step 3: Move reservation to the request boundary**

Remove the flat framework-stage charge. Before each initial/repair
`client.complete`, atomically reserve one provider cost unit and its
`maxTokens`. Throw a typed budget/timeout error that the source-grounded
executor converts to a visible unavailable reason and failed/truncation
checkpoint without negative evidence.

- [x] **Step 4: Run GREEN**

Run framework, Claude cancellation, and process-underwriting suites.

### Task 4: Readable replay checkpoints and lease-reclaim resumption

**Files:**
- Modify: `lib/contracts/underwriting.ts`
- Modify: `db/repositories/underwriting-runs.ts`
- Modify: `db/schema.ts`
- Modify: `drizzle/0012_source_grounded_underwriting.sql`
- Modify: `lib/underwriting/orchestrator.ts`
- Create: `lib/underwriting/stage-replay.ts`
- Modify: `tests/unit/underwriting-runs.test.ts`
- Modify: `tests/integration/process-run-underwriting.test.ts`

**Interfaces:**
- Produces: `listCheckpoints({ workspaceId, candidateRunId })`.
- Persists: `inputFingerprint`, `outputPayload`, `costUnits`, and
  `tokenUnits` per checkpoint.
- Consumes: per-stage replay parsers for saved grounding and framework
  outputs.

- [x] **Step 1: Write failing repository read and reclaim tests**

Persist a completed checkpoint, read it back exactly, expire the candidate
lease after framework completion, recreate the orchestrator, and assert
grounding/provider counters remain `1` while the candidate finishes. Assert
usage counters do not reset or double.

- [x] **Step 2: Run RED**

Expected: no checkpoint read API exists and reclaimed execution repeats
grounding/provider work.

- [x] **Step 3: Implement replayable checkpoints**

Extend memory, Supabase, schema, and RPC checkpoint shapes. Initialize usage
from persisted per-stage counts. Reuse a completed stage only when its saved
input fingerprint exactly matches and its output passes that stage's replay
parser; reject a completed checkpoint with mismatched input.

- [x] **Step 4: Run GREEN**

Run repository, reclaim, budget, and migration tests.

### Task 5: Exact `0012` source snapshot and schema parity

**Files:**
- Modify: `drizzle/0012_source_grounded_underwriting.sql`
- Modify: `db/schema.ts`
- Modify: `tests/integration/underwriting-finalization.test.ts`

**Interfaces:**
- Enforces: supplied snapshot JSON equals the canonical immutable
  `source_revisions` row.
- Enforces: pack revision IDs and snapshot revision IDs are duplicate-free
  and exactly equal.

- [x] **Step 1: Write failing live PostgreSQL probes**

Submit one altered `contentHash`, one omitted snapshot, one extra snapshot,
and one duplicate revision ID; each RPC call must fail and leave zero build
rows.

- [x] **Step 2: Run RED**

Expected: altered/partial snapshot payloads are accepted.

- [x] **Step 3: Implement byte and set equality**

Construct the canonical camelCase source-revision JSON from each immutable
database row, compare it to the supplied object, and use bidirectional
`EXCEPT` plus cardinality checks for exact set equality. Mirror every SQL
JSON-shape and identity constraint in `db/schema.ts`.

- [x] **Step 4: Run GREEN and final verification**

Run focused Task 13 tests, the full live PostgreSQL finalization suite,
`npm run typecheck`, `npm run lint`, and `git diff --check`. Append RED/GREEN
evidence to `task-13-report.md`, commit, and report the exact hash.

Sandbox note: focused/static migration assertions are green. A local
PostgreSQL cluster could not initialize because the managed sandbox denied
the required shared-memory segment, so the live probes remain environment-
skipped and are recorded in the fix report.
