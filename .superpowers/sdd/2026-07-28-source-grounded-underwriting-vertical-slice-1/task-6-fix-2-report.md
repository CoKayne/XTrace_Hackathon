# Task 6 Fix Round 2 Report

## Outcome

Closed both Important findings from the round-1 fix review while preserving the
exact-revision XTrace boundary and the retirement of staged-upload legacy
capabilities.

## Isolated memory promotion

Whole-store snapshots and restores were removed.

- The upload adapter compensates only the exact `(workspaceId, uploadId)` row
  and restores it only when its current value still matches this promotion's
  expected post-state.
- The Source Registry compensates only the exact revision and that revision's
  membership in its source history. Concurrent revisions for other sources
  are retained.
- The Deal Registry compensates only the promotion's company, Deal, request,
  source assignments, bundle, lineage, and exact-source bundle keys.
  Assignment changes use compare-and-restore; unrelated assignments are never
  replaced.
- The global assignment sequence is intentionally not rolled back, so
  compensation cannot reuse an ID allocated to a concurrent write.
- Task 6 promotions targeting the same `(workspaceId, dealId)` share a
  registry-owned lock across service instances. This prevents two different
  uploads for one existing Deal from invalidating each other's aggregate while
  ordinary unrelated writes remain unlocked.
- Source mutation uses a repository-owned per-source lock shared by ordinary
  initial creation, append, and the full promotion transaction. Promotions
  always acquire Source before Deal; ordinary mutations acquire at most their
  owning repository's lock.

The adversarial regressions pause a failing promotion after its revision and
Deal writes, then concurrently create:

- an upload, revision, and Deal in another workspace;
- an unrelated upload, revision, and Deal in the same workspace; and
- a second confirmed upload targeting the same existing Deal.

All concurrent artifacts survive. The failed promotion is fully compensated,
retry remains exactly-once and idempotent, and an exact-source append cannot
race compensation into an orphaned revision chain. The append waits for the
promotion; after rollback it fails cleanly because its parent revision does
not exist.

## Database-time lease transitions

`drizzle/0013_confirmed_upload_ingest.sql` now defines
`transition_uploaded_document_lease(...)`.

- It accepts the four terminal outcomes: extraction complete/fail and
  confirmed-ingest complete/fail.
- Its single `UPDATE` requires the exact workspace, upload, source status,
  worker, lease token, and
  `lease_expires_at > clock_timestamp()`.
- It validates extraction preview and failure payloads, clears lease fields,
  and returns whether exactly one row transitioned.
- The function is owned by `vsee_registry_owner`; execution is revoked from
  public, anonymous, and authenticated roles and granted to `service_role`.
- The Supabase adapter routes `savePreview`, `fail`, `completeConfirmed`, and
  `failConfirmed` through the RPC. It no longer uses expiry-blind PATCHes or an
  application clock for terminal ownership.

The live PostgreSQL regression proves that expired extraction and
confirmed-ingest owners cannot complete or fail, reclamation issues a new
lease, and the unexpired reclaimed owner can complete or fail.

## TDD Evidence

Memory RED:

```text
4 tests
0 passed
4 failed
```

The old whole-store restore deleted both unrelated writes and the successful
same-Deal promotion. The first scoped-compensation revision also allowed a
concurrent append to survive after its parent was deleted; the per-source lock
closes that exact interleaving with a one-second deadlock guard.

Lease RED:

```text
Supabase adapter: PATCH observed where POST RPC was required
Live PostgreSQL: transition_uploaded_document_lease(...) did not exist
```

Focused GREEN:

```text
250 tests
249 passed
0 failed
1 PostgreSQL-gated test skipped
```

Separate live PostgreSQL GREEN:

```text
2 passed
0 failed
0 skipped
```

## Verification

```text
npm run typecheck
→ passed

npm run lint
→ passed

git diff --check
→ passed
```

## Remaining concern

Task 13's `0012` is intentionally untouched. The merged branch must still run
the live migration suite over the final `0012 -> 0013` order.
