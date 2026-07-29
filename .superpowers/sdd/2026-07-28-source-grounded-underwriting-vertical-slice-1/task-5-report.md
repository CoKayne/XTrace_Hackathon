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

## Review round 1

Independent review initially returned **NOT APPROVED** with one critical,
seven important, and two moderate findings. All findings were addressed with
new RED tests followed by repository, migration, worker, schema, seed, and UI
changes.

### Security and atomicity

- Registry mutation now occurs only through narrowly scoped
  `SECURITY DEFINER` RPCs owned by the dedicated
  `vsee_registry_owner NOLOGIN NOINHERIT NOBYPASSRLS` role. Every definer RPC
  has `search_path = ''` and uses fully qualified application objects.
- `service_role` has registry-table `SELECT` plus explicit RPC execution, but
  no direct registry `INSERT`, `UPDATE`, `DELETE`, or `TRUNCATE`. Column-level
  Deal grants exclude `analysis_eligible_at` and
  `active_source_revision_fingerprint`.
- The annotation write moved from direct PostgREST table insertion to
  `annotate_source_revision`.
- Live exploit tests prove RPC writes and reads succeed while direct revision,
  annotation, assignment, eligibility, fingerprint, and truncate mutations
  fail. Catalog assertions verify the dedicated owner and locked search path.
- Exact append retry resolves the immutable target under the per-source lock
  before checking the current predecessor. Immediate replay, replay after a
  later revision, and mismatched replay are covered in memory and live
  PostgreSQL.
- Confirmation request IDs now persist a canonical semantic fingerprint over
  workspace, Deal, company identity, status, revision, actor, reason, and
  normalized confirmation time. Any changed field is rejected.

### Ownership, fingerprints, and snapshots

- Evidence and interactions persist `source_revision_id`. The Deal Registry
  validates internal workspace/Deal/source/revision ownership on ingress and
  verifies that every row still matches an active assignment on egress.
  Internal interaction identity is retained without changing the public
  `DealMemoryBundle` shape.
- Active-revision fingerprints use injective UTF-8 length framing, bytewise
  `C` ordering, and SHA-256 in both TypeScript and PostgreSQL. Tests cover
  commas, punctuation, case, composed/decomposed non-ASCII, exact bytes/hash,
  and SQL/TypeScript parity. Deal ordering uses the same UTF-8 comparator.
- New analysis reports require both eligible snapshot count and fingerprint.
  These are stored internally, checked atomically against analysis length and
  `company_count`, and cannot be replaced for the same report/run by a
  different snapshot. Legacy report responses expose neither field.
- Production captures the snapshot from registered Deals and their active
  source-revision fingerprints. Dynamic three-Deal persistence and omitted,
  mismatched, and reclaimed-run overwrite cases are covered.
- Production and UI copy no longer hard-code 19; the number remains only in
  fixed corpus fixtures and tests describing that fixture.

### Backfill and schema parity

- Backfill request and assignment IDs use injective tuple framing plus SHA-256;
  a live delimiter-collision fixture retains both assignments.
- Seed/migration provenance is aligned to `preloaded-pdf` version `1`.
  Backfill accepts documented historical timestamp differences only and
  rejects extractor identity/version drift.
- `db/schema.ts` mirrors every `0009` CHECK, status constraint, workspace
  composite foreign key, and partial unique index. Live catalog assertions
  compare the mirrored constraint set and index predicate.

### Review verification

- Focused repository/UI tests: **41 passed, 0 failed**.
- Full regression: **485 discovered; 484 passed, 0 failed, 1 skipped**. The
  skip is the existing opt-in external XTrace live test.
- `npm run typecheck`: passed.
- `npm run lint`: passed with no warnings or errors.
- `npm run test:migrations`: **7 passed, 0 failed, 0 skipped**.

### Operational preflight

Migration `0009` is intentionally fail-closed. The managed-Supabase migration
deployment role must be permitted to create/alter the dedicated NOLOGIN role,
alter function ownership, create policies, and grant least privileges. If it
cannot establish that boundary, deployment must stop; there is no privileged
owner fallback. Apply the migration through the administrative migration
channel before starting the worker.

The initial Task 5 implementation commit was
`42f1585bfb45bdb4cb03955017566c4f2080f3d1`. The review-fix commit is reported
in the handoff because a commit cannot contain its own SHA.

## Review round 2

The second independent review returned **NOT APPROVED** with one critical and
six important findings. Each finding was reproduced with a failing focused
test before implementation and then verified in memory and/or live PostgreSQL
as appropriate.

### C1 — report-table privilege boundary

- `service_role` now has read-only access to `intelligence_reports` and
  `company_analyses`; direct `INSERT`, `UPDATE`, `DELETE`, and `TRUNCATE` are
  revoked on both tables.
- Report cleanup moved behind the locked
  `reset_intelligence_products(text)` definer RPC.
- Live catalog and exploit coverage uses a `BYPASSRLS` service role and proves
  all eight direct mutation classes fail while the RPC remains usable.

### I1 — authoritative eligible snapshots

- `get_analysis_eligible_snapshot(text)` derives the eligible Deal IDs and
  active-revision fingerprints under a workspace advisory lock and returns a
  canonical count, ordered IDs, and SHA-256 token.
- Assignment confirmation takes the same workspace lock. Report persistence
  recomputes the authoritative snapshot under that lock and rejects false
  counts, false fingerprints, missing/duplicate/foreign Deal analyses, and
  reassignment races.
- The worker captures the canonical snapshot before and after loading bundles,
  requires exact identity stability, and has no Deal-ID-only fallback.
- New-analysis repository and worker seams require the canonical
  `sha256:<64 lowercase hex>` token.

### I2 — report identity parity

- Memory report identity now binds exact `runId`, count, and fingerprint,
  including null-versus-bound state, and clears that metadata on reset.
- Memory and live PostgreSQL tests cover legacy-to-bound, bound-to-legacy, and
  same-snapshot cross-run overwrite rejection.

### I3 — portable confirmation fingerprints

- SQL now frames confirmation timestamps as fixed UTC ISO-8601 with exactly
  millisecond precision, matching `Date.toISOString()`.
- Live replay succeeds across `UTC` and `America/Los_Angeles` sessions and
  equivalent `Z`/offset inputs. The persisted SQL fingerprint is asserted
  byte-for-byte against the TypeScript vector.

### I4 — dedicated owner-role preflight

- Existing `vsee_registry_owner` roles are normalized to `NOSUPERUSER`,
  `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION`, `NOLOGIN`, `NOINHERIT`, and
  `NOBYPASSRLS`.
- All incoming and outgoing memberships are deliberately revoked, followed by
  a fail-closed catalog verification.
- The live fixture starts from a hostile privileged/login role with an
  inheriting member and verifies all attributes, memberships, and
  `service_role` assumability are false afterward.

### I5 — Drizzle constraint parity

- The misplaced `deals_status_check` was removed from `scanRunSteps` and
  remains only on `deals`.
- A Drizzle metadata test pins the table and exact declaration. Live catalog
  coverage pins the table/name/normalized PostgreSQL definition and proves a
  normal scan step can transition from `running` to `completed`.

### I6 — assignment chronology parity

- Memory confirmation rejects a backdated supersession before mutating any
  assignment state.
- Memory and live PostgreSQL coverage both accept equal and later instants,
  reject a backdated instant, and retain the prior active revision atomically.

### Review-round-2 verification

- Full regression: **491 discovered; 490 passed, 0 failed, 1 skipped**. The
  skip is the existing opt-in external XTrace live test.
- `npm run typecheck`: passed.
- `npm run lint`: passed with no warnings or errors.
- `npm run test:migrations`: **7 passed, 0 failed, 0 skipped**.
- `git diff --check`: passed.

The round-2 fix commit is reported in the handoff because a commit cannot
contain its own SHA.
