# Task 6 Fix Round 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve unrelated memory writes during failed upload promotion and enforce lease expiry with database time for every PostgreSQL terminal transition.

**Architecture:** Memory rollback will use repository-owned, promotion-scoped compensation tokens rather than whole-store snapshots. PostgreSQL extraction and confirmed-ingest terminal outcomes will use one controlled RPC whose `UPDATE` predicate checks status, worker, token, and `lease_expires_at > clock_timestamp()` atomically.

**Tech Stack:** TypeScript, Node test runner, in-memory repository adapters, PostgreSQL PL/pgSQL, PostgREST RPC.

## Global Constraints

- Preserve the exact confirmed-source tuple and legacy access fixes from round 1.
- Preserve all-or-none promotion and idempotent retry behavior.
- Concurrent unrelated writes in another workspace or the same workspace must survive rollback.
- Do not rely on a service-local mutex for isolation.
- Do not reset global sequence counters during compensation.
- Keep Task 6 migration at `drizzle/0013_confirmed_upload_ingest.sql`; do not touch Task 13 or `0012`.

---

### Task 1: Promotion-scoped memory compensation

**Files:**
- Modify: `tests/unit/upload-confirmation.test.ts`
- Modify: `db/repositories/uploaded-documents.ts`
- Modify: `db/repositories/source-registry.ts`
- Modify: `db/repositories/deal-registry.ts`
- Modify: `lib/uploads/confirmation.ts`

**Interfaces:**
- Consumes: existing `createInitialRevision`, `confirmSourceAssignment`, and `markConfirmed` mutations.
- Produces: memory-only scoped compensation capability with `capturePromotionState(scope)` and `restorePromotionState(before, expected)` methods.

- [x] **Step 1: Write failing concurrency tests**

Add tests that pause a promotion after its Source Revision write, create an unrelated upload/revision/Deal in another workspace and in the same workspace, then force Deal confirmation failure:

```ts
await assert.rejects(failingConfirmation, /injected/);
assert.ok(await unrelatedUploads.get(unrelatedUploadIdentity));
assert.ok(await sources.getRevision(unrelatedRevisionIdentity));
assert.ok(await deals.findForWorkspace(unrelatedDealIdentity));
```

Retain assertions that the failed promotion leaves no revision, assignment, or receipt and that retry creates exactly one of each.

- [x] **Step 2: Run RED**

Run:

```text
node --import tsx --test --test-name-pattern='unrelated|rolls back|retry' tests/unit/upload-confirmation.test.ts
```

Expected: unrelated artifacts disappear under the current whole-store restore.

- [x] **Step 3: Implement scoped compare-and-compensate**

Replace whole-store state hooks with promotion-scoped tokens:

```ts
interface AtomicMemoryAdapter<Scope, State> {
  capturePromotionState(scope: Scope): State;
  restorePromotionState(before: State, expected: State): void;
}
```

Upload compensation touches only `(workspaceId, uploadId)`. Source
compensation removes/restores only the exact revision and its source-list
membership while preserving concurrently added revision IDs. Deal
compensation touches only the confirmation's company, Deal, request,
assignment/source, bundle, lineage, and exact-bundle identities; it restores
only values still equal to the promotion's expected post-state. Do not restore
`assignmentSequence`.

- [x] **Step 4: Run GREEN**

Run the Task 1 pattern and complete upload-confirmation unit file. Expected:
all pass, including basic failure rollback and cross-service idempotence.

### Task 2: Database-time terminal lease transitions

**Files:**
- Modify: `tests/unit/upload-staging-lifecycle.test.ts`
- Modify: `tests/integration/upload-confirmation-migration.test.ts`
- Modify: `db/repositories/uploaded-documents.ts`
- Modify: `drizzle/0013_confirmed_upload_ingest.sql`

**Interfaces:**
- Consumes: existing lease claim and renewal RPCs.
- Produces:

```sql
public.transition_uploaded_document_lease(
  p_workspace_id text,
  p_upload_id text,
  p_worker_id text,
  p_lease_token uuid,
  p_transition text,
  p_extraction_preview jsonb,
  p_failure_reason text
) returns boolean
```

- [x] **Step 1: Write failing adapter and live PostgreSQL tests**

Assert all four Supabase methods call the RPC rather than PATCH. In live
PostgreSQL, claim extraction and confirmed-ingest rows with one-second leases,
advance database time by setting their expiry in the past, and prove both
completion and failure return false. Reclaim each row and prove an unexpired
owner can perform the matching terminal outcome.

- [x] **Step 2: Run RED**

Run:

```text
node --import tsx --test tests/unit/upload-staging-lifecycle.test.ts
REQUIRE_POSTGRES_MIGRATION_TESTS=1 node --import tsx --test tests/integration/upload-confirmation-migration.test.ts
```

Expected: adapter still issues direct PATCH and live expired transitions are
not protected by a controlled RPC.

- [x] **Step 3: Implement the controlled RPC**

Validate `p_transition` as one of `extraction_complete`,
`extraction_fail`, `confirmed_complete`, or `confirmed_fail`. Perform exactly
one `UPDATE` with the required source status, worker, token, and:

```sql
and upload.lease_expires_at > clock_timestamp()
```

Set the target status/payload and clear lease fields. Own the function by
`vsee_registry_owner`, revoke public/anonymous/authenticated access, and grant
only `service_role`.

- [x] **Step 4: Route the Supabase adapter through the RPC**

Use the same RPC helper for `savePreview`, `fail`, `completeConfirmed`, and
`failConfirmed`, returning the database boolean without consulting the
application clock.

- [x] **Step 5: Run GREEN**

Run the unit adapter suite and live migration suite. Expected: expired owners
cannot complete/fail; reclaimed unexpired owners can.

### Task 3: Regression verification and handoff

**Files:**
- Create: `.superpowers/sdd/2026-07-28-source-grounded-underwriting-vertical-slice-1/task-6-fix-2-report.md`

- [x] **Step 1: Run focused verification**

Run Task 6 upload, worker, XTrace, repository, authorization, and migration
tests. Run the live PostgreSQL migration test separately.

- [x] **Step 2: Run static verification**

```text
npm run typecheck
npm run lint
git diff --check
```

- [x] **Step 3: Write the fix report**

Record both RED failures, scoped compensation semantics, RPC/database-time
semantics, exact pass/fail/skip counts, and the unchanged post-merge
`0012 -> 0013` verification concern.

- [ ] **Step 4: Commit**

Stage only Task 6 product code, tests, this plan, and the fix report. Commit
with:

```text
fix: isolate upload promotion and lease transitions
```
