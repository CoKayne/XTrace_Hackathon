# Task 6 Fix Round 1 Report

## Outcome

Closed all four Important findings from `task-6-review.md`:

1. Confirmed-source ingest is bound to the exact
   `(workspaceId, dealId, sourceId, sourceRevisionId)` tuple.
2. Staged uploads can no longer masquerade as immutable Source Revisions
   through the legacy document access and serving routes.
3. The memory adapter's upload promotion is atomic and rolls back every
   repository on failure.
4. Extraction and confirmed-ingest mutations reject expired lease owners.

Migration `drizzle/0013_confirmed_upload_ingest.sql` remains after the existing
migration sequence and was not renumbered.

## Corrections

### Exact revision ownership

- Added `DealRegistry.getExactSourceBundle(...)` for exact revision lookups.
- Memory confirmation retains an immutable bundle per exact source revision
  instead of resolving only the latest bundle for a source.
- PostgreSQL lookup scopes the deal-source assignment and evidence rows to the
  exact workspace, deal, document, and source revision.
- Confirmed-source ingest validates every tuple component before persisting
  XTrace facts.
- A newer revision of the same source cannot be ingested under an older
  revision's lineage.

### Source Revision serving boundary

- Removed staged-upload fallback behavior from:
  - `GET /api/documents/:id/access`
  - `GET /api/documents/:id`
- Those compatibility routes now resolve only preloaded documents or
  authoritative Source Registry revisions.
- A staged upload ID receives `404`, and even a manually signed capability for
  that ID cannot read the staging object.

### Atomic memory promotion

- Memory upload, Source Registry, and Deal Registry adapters expose deep
  checkpoint/restore hooks for the promotion transaction.
- Promotion snapshots all three repositories, applies the revision,
  assignment, and upload receipt, and restores all snapshots in reverse order
  if any mutation fails.
- The fallback fails before writing unless all three adapters participate in
  the atomic protocol and the Deal Registry uses the same Source Registry.
- Confirmation locks and the memory promotion mutex are shared by repository
  identity, so independently constructed services cannot race on the same
  upload.
- PostgreSQL continues to use the single `confirm_uploaded_source` RPC.

### Lease expiry enforcement

- Memory extraction lease renewal, preview save, and failure transitions now
  require an unexpired matching lease.
- Memory confirmed-ingest lease renewal, completion, and failure transitions
  enforce the same rule.
- After expiry, the stale worker cannot mutate the record and a second worker
  can reclaim it with a new token, matching the PostgreSQL contract.

## TDD Evidence

The regression tests were added before the implementation. The focused RED
runs demonstrated:

- a newer source revision was ingested with the older revision's lineage;
- the memory Deal Registry had no exact-revision lookup;
- legacy document access returned a staged-upload redirect instead of `404`;
- a failed upload or Deal mutation left a Source Revision behind;
- two confirmation services could race outside a shared lock; and
- expired extraction and confirmed-ingest owners could still renew or perform
  terminal mutations.

After the fixes, the focused Task 6, authorization, worker, XTrace, and
repository suite completed with:

```text
245 tests
244 passed
0 failed
1 PostgreSQL-gated test skipped
```

The PostgreSQL-gated migration suite was also run with live database access:

```text
2 passed
0 failed
0 skipped
```

That live run verifies a failed confirmation leaves no partial Source
Revision, assignment, or receipt, and a retry succeeds exactly once.

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

This branch predates the Task 13-owned `0012` migration. The live test proves
the current migration chain through `0013`; the merged branch should also run
the PostgreSQL suite over the final `0012 -> 0013` order.
