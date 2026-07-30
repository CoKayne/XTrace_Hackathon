# Task 13 Fix Round 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining Task 13 persistence-bypass, provider-ledger, migration-upgrade, schema-parity, and concurrent-idempotency gaps without changing approved source grounding, aliasing, or exact candidate claiming.

**Architecture:** A non-alias candidate may finalize only when its payload names an immutable Evidence Pack build whose workspace, Deal, pack ID, input fingerprint, and exact pack JSON match the target and `evidence_pack_builds`. Provider checkpoints carry a settled-or-reserved ledger whose enforced totals replace reservations with known provider usage and conservatively retain reservations when usage is unknown. Migration `0012` becomes upgrade-safe by replacing tightened constraints explicitly, and its immutable writes use conflict-safe insert-then-compare semantics.

**Tech Stack:** TypeScript, Node test runner, Zod, PostgreSQL/PLpgSQL, Supabase PostgREST, Drizzle schema.

## Global Constraints

- Preserve benchmark/profile temporal validation, immutable definition fingerprints, stable grounding identity, real forced-rerun aliases, and C3 exact workspace/candidate claim behavior.
- Do not change Task11b or Task12 decision behavior.
- Do not add Task14/15 UI or API scope.
- Write and observe an adversarial RED test before each production change.
- Reuse aliases must remain artifact-free aliases and must not require a second Evidence Pack build.
- Unknown provider outcomes retain their reservation; known usage replaces the reservation for subsequent enforcement.

---

### Task 1: Guard non-reuse finalization with an immutable Evidence Pack build

**Files:**
- Modify: `db/repositories/underwriting-artifacts.ts`
- Modify: `db/repositories/underwriting-runs.ts`
- Modify: `lib/underwriting/candidate-grounding.ts`
- Modify: `lib/underwriting/orchestrator.ts`
- Modify: `lib/underwriting/stage-replay.ts`
- Modify: `worker/runner.ts`
- Modify: `drizzle/0012_source_grounded_underwriting.sql`
- Modify: `tests/integration/process-run-underwriting.test.ts`
- Modify: `tests/integration/underwriting-finalization.test.ts`
- Modify: `tests/unit/underwriting-runs.test.ts`

**Interfaces:**
- Produces: `GroundedEvidencePack.buildInputFingerprint: string`.
- Produces: `CandidateFinalization.evidencePackBuildInputFingerprint: string`.
- Consumes: `EvidencePacksRepository.findByInputFingerprint({ workspaceId, inputFingerprint })`.

- [ ] **Step 1: Write adversarial finalization tests**

Add memory and live PostgreSQL cases that attempt non-reuse finalization
with no saved build, a wrong input fingerprint, altered pack JSON, foreign
workspace, and foreign Deal. Assert each fails while the candidate remains
running and no artifact rows exist. Save the exact build and assert the same
payload succeeds. Keep the existing linked-rerun test and assert the alias
creates no second artifact bundle or Evidence Pack row.

- [ ] **Step 2: Run RED**

Run:
`node --import tsx --test --test-name-pattern='Evidence Pack build|guarded finalization|immutable artifact alias' tests/integration/underwriting-finalization.test.ts tests/integration/process-run-underwriting.test.ts tests/unit/underwriting-runs.test.ts`

Expected: the typed fingerprint is missing, memory accepts an unsaved pack,
and the SQL wrapper delegates unchecked to the legacy finalizer.

- [ ] **Step 3: Propagate and validate the exact build identity**

After the builder saves a pack, resolve that exact saved build and return its
canonical input fingerprint with the grounded pack. Persist the fingerprint
through replay and finalization. Before memory non-reuse finalization,
resolve `(workspaceId, inputFingerprint)` and require the saved pack to
equal the supplied pack exactly and to match the candidate Deal.

In `finalize_or_reuse_candidate_underwriting`, leave the validated alias
branch unchanged. Before the non-reuse delegation, require:

```sql
evidence_pack_builds.workspace_id = target.workspace_id
and evidence_pack_builds.input_fingerprint =
  p_payload ->> 'evidencePackBuildInputFingerprint'
and evidence_pack_builds.pack_id =
  p_payload -> 'evidencePack' ->> 'id'
and evidence_pack_builds.pack_payload = p_payload -> 'evidencePack'
```

Also require the pack JSON workspace and Deal to equal the target row.
Revoke direct `EXECUTE` on `finalize_candidate_underwriting(jsonb)` from
`public`, `service_role`, `anon`, and `authenticated`; grant only the guarded
wrapper to the runtime role.

- [ ] **Step 4: Run GREEN**

Run the command from Step 2 and the full Task 13 finalization suite.

### Task 2: Enforce settled provider usage and restore it exactly

**Files:**
- Modify: `lib/contracts/underwriting.ts`
- Modify: `lib/underwriting/candidate-stage-runtime.ts`
- Modify: `db/schema.ts`
- Modify: `drizzle/0012_source_grounded_underwriting.sql`
- Modify: `tests/contracts/underwriting.test.ts`
- Modify: `tests/integration/process-run-underwriting.test.ts`
- Modify: `tests/unit/underwriting-runs.test.ts`

**Interfaces:**
- Extends: `CandidateProviderAttempt` with known-usage settlement metadata.
- Persists: checkpoint `costUnits` and `tokenUnits` as enforced totals:
  settled known actual usage plus outstanding conservative reservations.

- [ ] **Step 1: Write the reviewer-style overage and reclaim tests**

Use an 8,000-token candidate budget. Reserve 4,000 for the first physical
request and return measured usage totaling 6,001. Attempt a second 4,000
initial or repair request and assert it is rejected before its operation
runs. Persist the checkpoint, reclaim the lease, and assert the restored
enforced total is 6,001 rather than 4,000 or 10,001. Add a retryable network
failure case whose unknown usage retains the full 4,000 reservation. Start
four provider operations concurrently, settle them out of order, and assert
all four attempts and exact enforced/actual totals remain in the checkpoint.

- [ ] **Step 2: Run RED**

Run:
`node --import tsx --test --test-name-pattern='6001|settled provider|unknown provider|reclaimed lease' tests/integration/process-run-underwriting.test.ts tests/unit/underwriting-runs.test.ts tests/contracts/underwriting.test.ts`

Expected: the second operation starts because enforcement still counts the
original 4,000 reservation, and replay restores 4,000.

- [ ] **Step 3: Replace reservations when usage becomes known**

At reservation time, persist the conservative requested cost/token units.
At completion or measured truncation, mark usage known, replace that
attempt's reserved contribution with actual cost/token units, update the
checkpoint enforced totals by the delta, and accumulate reporting totals.
For network/unknown outcomes, keep the reservation as the enforced
contribution. Initialize runtime enforcement from persisted checkpoint
totals so lease reclaim is exact. Serialize only checkpoint ledger
read-modify-save transitions per runtime; release that queue before provider
I/O so independent provider operations remain concurrent.

- [ ] **Step 4: Run GREEN**

Run the command from Step 2 plus framework-lens and Claude-client suites.

### Task 3: Make tightened `0012` constraints upgrade-safe and restore Drizzle parity

**Files:**
- Modify: `drizzle/0012_source_grounded_underwriting.sql`
- Modify: `db/schema.ts`
- Modify: `tests/integration/underwriting-finalization.test.ts`
- Modify: `tests/integration/schema-migrations.test.ts`

**Interfaces:**
- Replaces: every tightened named `0012` constraint with the current exact definition.
- Adds: matching Critical Evidence array-shape constraints to Drizzle.

- [ ] **Step 1: Write upgrade/reapply and parity tests**

Create an earlier-`0012` shape whose identity checks permit JSON null/missing
keys, apply the revised migration, and assert those rows are rejected by the
new coalesced constraints. Reapply the revised migration and assert success.
Assert SQL and Drizzle both name and implement:

```text
source_evidence_items_payload_shape_check
source_evidence_items_payload_identity_check
evidence_pack_builds_input_fingerprint_check
evidence_pack_builds_payload_shape_check
evidence_pack_builds_snapshots_shape_check
evidence_pack_builds_payload_identity_check
critical_evidence_profile_fields_assertion_statuses_shape_check
critical_evidence_profile_fields_freshness_shape_check
```

- [ ] **Step 2: Run RED**

Run:
`node --import tsx --test --test-name-pattern='0012.*reapply|constraint parity|Critical Evidence.*array' tests/integration/underwriting-finalization.test.ts tests/integration/schema-migrations.test.ts`

Expected: `CREATE TABLE IF NOT EXISTS` leaves old constraints installed and
Drizzle lacks both Critical Evidence array checks.

- [ ] **Step 3: Replace named constraints explicitly**

After table creation, use `ALTER TABLE ... DROP CONSTRAINT IF EXISTS ...`
followed by `ADD CONSTRAINT ...` for every tightened check. Give the SQL
fingerprint check the same name and regex semantics as Drizzle. Add both
Critical Evidence JSON-array checks to `db/schema.ts` with identical names.

- [ ] **Step 4: Run GREEN**

Run the command from Step 2 and static migration/schema tests.

### Task 4: Make immutable save RPCs concurrently idempotent

**Files:**
- Modify: `drizzle/0012_source_grounded_underwriting.sql`
- Modify: `tests/integration/underwriting-finalization.test.ts`

**Interfaces:**
- Guarantees: two concurrent byte-identical calls both succeed.
- Guarantees: a conflicting payload on either immutable key fails closed.

- [ ] **Step 1: Write live concurrent transaction tests**

Open two independent PostgreSQL sessions. Invoke
`save_source_evidence_items` concurrently with the same immutable item and
assert both transactions commit. Repeat for `save_evidence_pack_build`.
Then race or replay a differing payload on the same key and assert one call
fails while the stored row remains the first exact payload.

- [ ] **Step 2: Run RED**

Run:
`REQUIRE_POSTGRES_MIGRATION_TESTS=1 node --import tsx --test --test-name-pattern='concurrent immutable' tests/integration/underwriting-finalization.test.ts`

Expected: both current functions can observe no row and one transaction
loses the insert unique-key race.

- [ ] **Step 3: Use insert-on-conflict followed by exact comparison**

For each item/build, attempt `INSERT ... ON CONFLICT DO NOTHING`, then lock
and select the canonical stored row by its immutable identity. Return only
when every stored key and JSON payload equals the request; otherwise raise.
For Evidence Packs, handle both unique identities
`(workspace_id,input_fingerprint)` and `(workspace_id,pack_id)` and compare
both keys plus snapshot JSON.

- [ ] **Step 4: Run GREEN**

Run the live concurrency command. If the managed sandbox cannot start or
reach PostgreSQL, retain the executable non-skipped test behind the existing
environment gate and record the exact environmental error.

### Task 5: Final report, verification, and commit

**Files:**
- Modify: `.superpowers/sdd/2026-07-28-source-grounded-underwriting-vertical-slice-1/task-13-report.md`

- [ ] **Step 1: Append fix-round-3 RED/GREEN evidence**

Document finalization bypass prevention, settled provider enforcement,
upgrade-safe constraints, Drizzle parity, concurrent idempotency, and the
exact live PostgreSQL result or blocker.

- [ ] **Step 2: Run final verification**

Run focused Task 13 tests, `npm test`, `npm run typecheck`,
`npm run lint -- --quiet`, and `git diff --check`.

- [ ] **Step 3: Review the scoped diff**

Confirm no Task11b/12 behavior and no Task14/15 path changed. Request an
independent review against the completed immutable commit.

- [ ] **Step 4: Commit**

Commit the complete product fix and report its exact SHA and verification
evidence.
