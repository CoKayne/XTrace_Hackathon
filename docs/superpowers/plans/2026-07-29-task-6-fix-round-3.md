# Task 6 Fix Round 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make memory upload promotion serialize with every same-Deal mutation and every same-upload confirmation wrapper, while preserving the Task 13 → Task 6 migration order.

**Architecture:** The memory Deal registry owns a keyed mutation lock for each `(workspaceId, dealId)`. Its public confirmation method acquires that lock, while promotion receives a scope-bound internal confirmation callback so Source → Deal lock acquisition remains non-reentrant. Each uploaded-documents repository instance similarly owns a keyed confirmation lock whose method survives object spreading because it closes over repository state; Supabase's confirmation RPC remains authoritative across processes.

**Tech Stack:** TypeScript, Node test runner, memory repositories, Supabase/PostgreSQL RPC migrations, Drizzle journal metadata.

## Global Constraints

- Preserve exact `(workspaceId, dealId, sourceId, sourceRevisionId)` ingest.
- Preserve lease-token and database-time expiry enforcement.
- Preserve retired legacy staged-upload access.
- Promotion lock order remains Source → Deal.
- Do not copy Task 13 migration `0012` into this branch.

---

### Task 1: Serialize ordinary and promoted Deal mutations

**Files:**
- Modify: `tests/unit/upload-confirmation.test.ts`
- Modify: `db/repositories/deal-registry.ts`
- Modify: `lib/uploads/confirmation.ts`

**Interfaces:**
- Consumes: `MemoryDealRegistry.withPromotionLock` and `DealRegistry.confirmSourceAssignment`.
- Produces: a promotion callback with the exact `DealRegistry["confirmSourceAssignment"]` contract, valid only for the locked Deal scope.

- [ ] **Step 1: Write the failing adversarial test**

Pause a failing promotion after it writes its Source Revision and Deal assignment. Start a direct `confirmSourceAssignment` for another source on the same Deal and assert it settles before rollback under the broken implementation. After rollback, assert the successful revision and assignment remain, the failed revision and assignment are absent, and `activeSourceRevisionIds` plus `activeSourceRevisionFingerprint` describe only live revisions.

- [ ] **Step 2: Run the focused test to verify RED**

Run:

```bash
node --import tsx --test --test-name-pattern="ordinary same-Deal assignment" tests/unit/upload-confirmation.test.ts
```

Expected: failure because the direct assignment bypasses the promotion lock and leaves the Deal snapshot stale after compensation.

- [ ] **Step 3: Implement the minimal registry-owned lock**

Extract the current memory assignment body into an internal function. Make public `confirmSourceAssignment` acquire the repository-owned Deal lock. Change `withPromotionLock` to pass a scope-bound internal callback that:

```ts
type LockedConfirmation =
  DealRegistry["confirmSourceAssignment"];
```

The callback rejects another workspace or Deal and becomes invalid when the promotion lock exits. Update memory promotion to call that callback instead of re-entering the public method.

- [ ] **Step 4: Run the focused test to verify GREEN**

Run the Task 1 pattern plus `tests/unit/deal-registry.test.ts`.

### Task 2: Serialize same-upload confirmations through repository state

**Files:**
- Modify: `tests/unit/upload-confirmation.test.ts`
- Modify: `db/repositories/uploaded-documents.ts`
- Modify: `lib/uploads/confirmation.ts`

**Interfaces:**
- Consumes: `UploadedDocumentsRepository`.
- Produces:

```ts
withConfirmationLock<T>(
  scope: { workspaceId: string; uploadId: string },
  operation: () => Promise<T>,
): Promise<T>;
```

- [ ] **Step 1: Write the failing two-wrapper test**

Create two distinct object-spread wrappers over one memory upload repository, pause the winning service after its Deal write, then start an identical confirmation through the second wrapper. Assert the second call waits and ultimately returns the identical receipt with one revision and one assignment.

- [ ] **Step 2: Run the focused test to verify RED**

Run:

```bash
node --import tsx --test --test-name-pattern="distinct upload wrappers" tests/unit/upload-confirmation.test.ts
```

Expected: failure because the wrappers receive separate WeakMap lock sets and the loser observes an immutable confirmation mismatch.

- [ ] **Step 3: Move the lock into repository state**

Add `withConfirmationLock` to both memory and Supabase repository instances. Each implementation closes over its repository-local keyed lock map, so object-spread wrappers retain the same operation and lock identity. Remove the service WeakMap and call the repository method around the full confirmation flow.

- [ ] **Step 4: Run the focused test to verify GREEN**

Run the Task 2 pattern plus upload extraction and confirmation unit tests.

### Task 3: Preserve journal and live migration order

**Files:**
- Modify: `drizzle/meta/_journal.json`
- Modify: `tests/integration/upload-confirmation-migration.test.ts`

**Interfaces:**
- Consumes: reserved Task 13 journal entry `{ idx: 12, when: 1785369431000 }`.
- Produces: Task 6 entry `idx: 13` with a strictly later timestamp and a live-test migration list that includes `0012_source_grounded_underwriting.sql` automatically when present after integration.

- [ ] **Step 1: Write the order assertion and verify RED**

Assert the reserved/actual Task 13 entry and Task 6 entry have indices `[12, 13]` and strictly increasing timestamps. The current Task 6 timestamp must fail this assertion.

- [ ] **Step 2: Update the Task 6 timestamp**

Set the `0013_confirmed_upload_ingest` journal timestamp above `1785369431000`. Keep `idx: 13` and its tag unchanged.

- [ ] **Step 3: Prepare the complete live chain**

When `0012_source_grounded_underwriting.sql` exists, insert it between `0011` and `0013` in the live migration test. On this isolated branch it is absent, so do not duplicate Task 13's migration.

- [ ] **Step 4: Verify migration tests**

Run the journal test normally and the live PostgreSQL test with `REQUIRE_POSTGRES_MIGRATION_TESTS=1` when the local database allows it.

### Task 4: Verification, review, and handoff

**Files:**
- Create: `.superpowers/sdd/2026-07-28-source-grounded-underwriting-vertical-slice-1/task-6-fix-3-report.md`

**Interfaces:**
- Consumes: all Task 6 round-three changes.
- Produces: fresh test evidence and a commit SHA for the parent integrator.

- [ ] **Step 1: Run focused and adjacent tests**

Run upload confirmation, extraction, Deal registry, Source registry, authorization, worker, XTrace, and migration tests.

- [ ] **Step 2: Run static verification**

Run `npm run typecheck`, `npm run lint`, and `git diff --check`.

- [ ] **Step 3: Request independent code review**

Review the diff against the two concurrency findings and migration-order requirement. Fix all Critical or Important findings with an additional red/green cycle.

- [ ] **Step 4: Commit**

Commit only the focused round-three changes and report the SHA, exact verification counts, and the deferred merged `0012 → 0013` live-chain check if `0012` remains absent.
