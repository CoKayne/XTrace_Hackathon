# Task 6 Report — Confirmed Upload Ingest

## Outcome

Implemented the product upload-to-confirmation vertical slice:

- `POST /api/uploads` accepts only TXT, Markdown, JPEG, PNG, GIF, and WebP,
  stores the object privately, and returns `202` with an opaque upload ID and
  status.
- Extraction remains a preview-only stage. It creates no Deal, source
  assignment, eligibility state, or XTrace memory.
- `GET /api/uploads/:id` exposes a safe preview DTO and workspace-scoped
  candidate Deal choices.
- `POST /api/uploads/:id/confirm` requires an explicit existing-Deal or
  new-Deal identity. It rejects previews without a source-backed fact.
- Confirmation creates the exact immutable source revision, source evidence,
  Deal assignment, and eligibility transition. Equivalent replays return the
  same receipt; conflicting replays fail.
- A confirmed-source worker ingests only facts from that exact newly confirmed
  source into XTrace, persists source revision/source lineage, and marks the
  upload ready only after successful ingest.
- XTrace failures return the upload to a visible, retryable `confirmed` state
  with a fixed public message and no local-memory fallback.
- Exact source revision access is workspace-scoped and returns only a
  short-lived URL and expiry.

The legacy upload and uploaded-list routes remain temporary contract-identical
safe adapters. They do not expose a second upload model or private fields.

## Durable boundary

`drizzle/0013_confirmed_upload_ingest.sql` is an additive migration that:

- adds exact Deal/source/revision confirmation identity and lease-token
  capability columns;
- adds immutable source revision lineage to XTrace ingest jobs and memory
  links;
- restores incomplete pre-migration extractor claims to the queued state;
- normalizes legacy workspace-bearing upload IDs to content-derived opaque
  IDs before adding foreign keys;
- adds confirmation-shape, lease-shape, and exact workspace identity
  constraints;
- atomically and target-safely claims queued or confirmed uploads with
  `FOR UPDATE SKIP LOCKED`;
- guards lease renewal by workspace, upload, worker, unexpired lease, and
  random lease token;
- atomically inserts the source document, workspace association, initial
  revision, Deal assignment, evidence rows, eligibility state, and confirmed
  upload receipt through `confirm_uploaded_document`;
- restricts controlled functions to the service role and the registry owner.

The journal entry is index `13`. Index/file `0012` is reserved for Task 13 and
must precede this migration when the branches are integrated.

## Concurrency and idempotency

- In-memory confirmation serializes by the delimiter-safe
  `(workspaceId, uploadId)` identity and cleans completed lock entries.
- PostgreSQL confirmation locks the exact workspace upload row and performs
  all promotion writes in one transaction.
- Confirmation IDs and fingerprints are deterministic over the exact upload
  and selected Deal identity.
- Extraction and XTrace completion/failure writes require the current random
  lease token; stale workers cannot complete reclaimed work.
- The worker rotates queued upload, confirmed upload, and scan queues so
  confirmed-source ingest cannot starve.

## Public and tenant boundaries

- Public demo cannot upload, confirm, or create private source access.
- Product access derives workspace identity only from the trusted request
  context.
- Cross-workspace Deal selection and source revision access return not found.
- Preview/list DTOs omit workspace IDs, checksums, object keys, worker IDs,
  lease tokens, provider job IDs, recalled memory, extraction internals, and
  raw failure diagnostics.
- The supported formats did not expand to PDF, DOCX, or audio, and this task
  adds no Gmail, Drive, scheduling, sending, or publishing integration.

## TDD evidence

The initial focused RED failed on the missing confirmation service, routes,
worker, and migration. Additional regressions were also demonstrated RED
before their fixes:

- a preview with zero source-backed facts was incorrectly confirmable;
- the scheduler's fair-queue helper did not exist;
- confirmed-source ingest could have serialized facts from older Deal sources.

The final focused authorization, upload, worker, migration, and XTrace run:

```text
211 tests
210 passed
0 failed
1 skipped
```

The skipped test is the live PostgreSQL `0013` integration test. This
environment has neither a usable temporary PostgreSQL database nor the
privileges needed to create one. Its non-live companion verifies the migration
file and journal ordering.

The full repository run completed with:

```text
653 tests
635 passed
2 failed
16 skipped
```

Both failures are pre-existing chat-route integration tests that attempt to
listen on `127.0.0.1`; the managed sandbox rejects the bind with
`listen EPERM`. No Task 6 test failed.

## Final verification

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `git diff --check`: passed.
- Focused Task 6/auth/worker/XTrace suite: 210 passed, 0 failed, 1
  PostgreSQL-capability skip.

## Self-review and integration notes

- A confirmed upload assigned to an existing Deal now filters the loaded Deal
  bundle to the exact new `sourceId` and drops interactions before XTrace
  ingest. The job's declared revision lineage therefore matches all serialized
  evidence.
- Empty extracted documents cannot acquire confirmed source/Deal state.
- The source access capability is bound to workspace, revision ID, object
  version, permission, and expiry, and the document route resolves that exact
  immutable revision.
- Task 13 also changes `worker/runner.ts`. Integration must preserve Task 13's
  scan construction while adding Task 6's `processConfirmedSource` import,
  `runNextConfirmedUpload`, and fair three-queue dispatcher.
- The live migration test should be run after Task 13's `0012` migration is
  present and before deployment. No production migration claim is made from
  the sandbox-only skip.
