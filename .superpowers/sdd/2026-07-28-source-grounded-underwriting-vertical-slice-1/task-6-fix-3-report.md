# Task 6 Fix Round 3 Report

## Outcome

Closed the two remaining in-memory concurrency findings and corrected the
Drizzle journal order without changing the exact-revision XTrace boundary,
database-time lease transitions, or retired legacy-upload access.

## Repository-owned Deal mutation lock

The memory Deal Registry now owns one keyed mutation lock for each
`(workspaceId, dealId)`.

- Public `confirmSourceAssignment` enters that lock.
- Upload promotion still acquires Source before Deal.
- Once promotion holds the Deal lock, it receives a scope-bound internal
  confirmation callback instead of re-entering the public locked method.
- The callback rejects another workspace or Deal and is invalid after its lock
  scope exits. The lock awaits every callback invocation that started while
  the scope was active, even when its caller omitted `await`, so an asynchronous
  repository read cannot let a mutation resume after lock release.

The adversarial regression pauses a failing promotion after its Source
Revision and Deal assignment exist. A direct assignment for another source on
the same Deal waits for rollback, then succeeds. The final Deal fingerprint
and active revision IDs contain only the seed and successful revisions; the
failed revision and assignment are absent, and every remaining assignment has
a live Source Revision.

## Repository-owned upload confirmation lock

`UploadedDocumentsRepository` now exposes `withConfirmationLock` for exact
`(workspaceId, uploadId)` serialization. Both memory and Supabase repository
instances own their keyed lock map.

The method closes over repository state, so distinct object-spread wrappers
retain the same lock identity and operation. The service-level WeakMap was
removed. Supabase's `confirm_uploaded_document` RPC remains the authoritative
cross-process transaction boundary.

The two-wrapper regression uses different confirmation timestamps to make the
old race deterministic. Before the fix, the loser reached Source creation and
failed with an immutable-revision mismatch. After the fix, it reads the
confirmed row after the winner and returns the identical receipt; only one
revision and assignment exist.

## Migration order

The `0013_confirmed_upload_ingest` journal timestamp is now
`1785373200000`, strictly after Task 13's reserved `0012` timestamp
`1785369431000`.

The journal test asserts indices `[12, 13]` and increasing timestamps. This
isolated branch does not contain Task 13's migration file, so the test uses the
reserved entry for the order assertion. The live migration list automatically
inserts `0012_source_grounded_underwriting.sql` between `0011` and `0013` when
that file is present after integration. When the file exists, the test requires
its exact journal tag, index `12`, and timestamp `1785369431000`; the reserved
fallback is used only while the file is absent.

## TDD Evidence

RED:

```text
ordinary same-Deal assignment:
  settled during the paused promotion (true !== false)

distinct upload wrappers:
  Source revision 1 is immutable and already contains different data

journal order:
  Task 6 migration timestamp must follow Task 13
```

Targeted GREEN:

```text
3 passed
0 failed
```

## Verification

Broad Task 6 upload, authorization, registry, worker, and XTrace suite:

```text
258 total
256 passed
0 failed
2 gated skips (PostgreSQL migration and external XTrace live)
```

Separate live PostgreSQL migration run:

```text
2 passed
0 failed
0 skipped
```

Post-cleanup focused regression:

```text
41 total
40 passed
0 failed
1 PostgreSQL-gated skip
```

Static gates:

```text
npm run typecheck
  passed

npm run lint
  passed

git diff --check
  passed
```

## Independent review

The review found no Critical issues and two Important issues:

- an internal Deal confirmation started without `await` could outlive the lock;
- an integrated `0012` SQL file could use the reserved fallback despite a
  missing or mislabeled journal entry.

Both were fixed. The first has a paused-registry RED/GREEN regression; the
second now requires the exact integrated migration journal identity.

## Integration note

Task 13's `0012` remains intentionally absent and untouched on this branch.
After integration, rerun the live migration test over the now-prepared complete
`0012 -> 0013` chain.
