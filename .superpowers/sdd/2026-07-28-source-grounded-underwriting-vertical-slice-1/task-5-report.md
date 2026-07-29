# Task 5 Report: Immutable Source Revision and Unified Deal Registry

## Outcome

Implemented migration `0009_source_revision_deal_registry` and one
workspace-scoped Deal Registry for both seeded and explicitly confirmed
sources. Source revisions and annotations are append-only; source revision
numbers and supersession links are validated at the repository, RPC, trigger,
foreign-key, and uniqueness boundaries. Analysis eligibility now depends on
an explicit eligibility timestamp plus a deterministic active revision
fingerprint, not on a fixed count of 19.

The worker now obtains analysis bundles from the authoritative Deal Registry.
The supplied demo corpus remains an exact 19-Deal fixture, while report
validation uses the run's captured eligible Deal count and preserves the
legacy response shape.

## Files

Created:

- `drizzle/0009_source_revision_deal_registry.sql`
- `db/repositories/source-registry.ts`
- `db/repositories/deal-registry.ts`
- `scripts/backfill-source-registry.ts`
- `tests/unit/source-registry.test.ts`
- `tests/unit/deal-registry.test.ts`

Modified:

- `db/schema.ts`
- `drizzle/meta/_journal.json`
- `scripts/seed-demo.ts`
- `lib/corpus/service.ts`
- `db/repositories/intelligence.ts`
- `worker/runner.ts`
- `worker/process-run.ts`
- `tests/unit/intelligence-repository.test.ts`
- `tests/integration/schema-migrations.test.ts`
- `tests/integration/workspace-composite-migration.test.ts`
- `tests/integration/seed-demo.test.ts`
- `package.json`
- `README.md`
- `docs/demo-runbook.md`

## TDD Evidence

Initial RED:

- Command:
  `node --import tsx --test tests/unit/source-registry.test.ts tests/unit/deal-registry.test.ts tests/unit/intelligence-repository.test.ts tests/integration/schema-migrations.test.ts`
- Result: expected failures for missing Source/Deal registry modules and
  migration, plus the old `exactly 19` report validation rejecting a
  three-Deal eligible snapshot.

Additional RED cycles:

- Seed integration observed zero source revisions before seed/backfill wiring.
- Migration-upgrade replay rejected a migration-created revision whose
  immutable bytes/object identity matched but historical timestamps differed.
- Live PostgreSQL accepted an invalid direct revision 4 linked to revision 2
  before the exact-previous insert trigger was added.
- Supabase eligible reads accepted a stale active-revision fingerprint before
  repository egress validation was added.

Focused GREEN:

- Registry, intelligence, and seed tests: 34 passed, 0 failed.
- `npm run typecheck`: passed.
- `npm run lint`: passed with 0 warnings and 0 errors.

## Live PostgreSQL Migration Verification

Command: `npm run test:migrations`

Result: 7 passed, 0 failed, 0 skipped.

Verified:

- fresh `0000` through `0009` installation;
- legacy `0000` through `0008` data upgrade and source/Deal backfill;
- workspace-composite primary/foreign keys and colliding external IDs;
- immutable revision rows and exact previous-revision links;
- initial revision replay and assignment retry idempotency;
- Deal eligibility and deterministic active-source fingerprint;
- two simultaneous PostgreSQL append transactions, with exactly one
  revision 2 commit;
- operator documentation and no-skip migration command through `0009`.

## Full Regression

Command: `npm test` with the local socket permission required by existing Chat
and PostgreSQL integration tests.

Result: 479 tests discovered; 478 passed, 0 failed, 1 skipped. The single skip
is the existing opt-in external XTrace live test. Typecheck and lint also pass.

## Self-Review

- Preserved committed migration `0008`; all new database work is append-only
  migration `0009`.
- Preserved global content-addressed `source_documents`; no
  `workspace_documents` or private object-key boundary was weakened.
- Used injective JSON tuple keys in memory and workspace-composite keys,
  foreign keys, conflict targets, and request filters in PostgreSQL/Supabase.
- Confirming a source assignment does not read or mutate upload status and
  does not call XTrace.
- Source evidence and interactions are rejected at Deal Registry egress when
  their document is not among the Deal's active assigned sources.
- Legacy report response keys remain unchanged; `eligibleDealCount` is an
  internal write-time validation input only.
- Production intelligence no longer reads the fixed manifest directly.
- Fixed the migration/seed replay edge where immutable historical timestamps
  differ while content hash, object key/version, type, workspace, source, and
  revision remain identical.
- Added the missing explicit service-role grant for the helper invoked by the
  atomic confirmation RPC.

## Operational Concerns

- Apply `0009` after `0008` before starting a worker that uses Deal Registry.
- Run the idempotent demo seed/backfill after migration so all 14 supplied
  sources and the exact 19 fixture Deals are registered.
- `npm run test:migrations` intentionally requires a local PostgreSQL role
  able to create disposable databases and must not be replaced by the portable
  skipped migration tests.
- The in-memory registry remains process-local, matching the repository's
  existing development fallback limitation. Production Web and Worker
  processes must share Supabase PostgreSQL.
- Task 5 deliberately stops at registry confirmation. Upload-status
  transitions, confirmation routes, and XTrace ingestion remain Task 6.

## Commit

- Required commit message:
  `feat(registry): unify seeded and confirmed Deal evidence`
- Verified implementation snapshot SHA: `f92d799`
- The final amended task commit SHA is reported in the task handoff because a
  Git commit cannot contain its own SHA.
