# Task 3 Report: Authorize all workspace API routes

## Commit

- Base SHA: `28d770a78d005d89bc1c3a29b42810cd4f851fce`
- Commit message: `feat(security): authorize all workspace API routes`
- Final SHA: reported in the Task 3 handoff because a commit cannot embed its
  own content-derived SHA.

## Route inventory

All 20 current route files and all 21 exported handlers resolve
`resolveRequestContext(request)` before data access and check an explicit
permission.

| Method | Route | Permission / public-demo policy |
| --- | --- | --- |
| POST | `/api/chat` | `readWorkspace`; read-only |
| GET | `/api/deals` | `readWorkspace`; fixed demo corpus allowed |
| GET | `/api/deals/[id]` | `readWorkspace`; fixed demo corpus allowed |
| GET | `/api/deals/[id]/analyses` | `readWorkspace`; repository workspace scoped |
| POST | `/api/demo/reset` | `mutateSources`; public demo forbidden |
| GET | `/api/documents` | `readWorkspace`; fixed demo corpus allowed |
| GET | `/api/documents/[id]` | fixed preloaded PDF allowed in public demo; product/private reads require `readPrivateSources` and a matching capability |
| GET | `/api/documents/[id]/access` | fixed preloaded redirect allowed without a private capability in public demo; product/private issuance requires `readPrivateSources` |
| POST | `/api/documents/upload` | `mutateSources`; public demo forbidden |
| GET | `/api/documents/uploaded` | `readPrivateSources`; public demo forbidden |
| POST | `/api/imports/confirm` | `mutateSources`; public demo forbidden |
| POST | `/api/imports/preview` | `readWorkspace`; fixed corpus preview |
| GET | `/api/market/events` | `readWorkspace`; repository workspace scoped |
| GET | `/api/overview` | `readWorkspace`; fixed demo corpus allowed |
| GET | `/api/reports` | `readWorkspace`; list and run-ID reads workspace scoped |
| GET | `/api/reports/[id]` | `readWorkspace`; report-ID read workspace scoped |
| GET | `/api/reports/[id]/companies/[dealId]` | `readWorkspace`; report-ID read workspace scoped |
| GET | `/api/runs` | `readWorkspace`; repository workspace scoped |
| POST | `/api/runs` | `readWorkspace`; scan creation retained, with server-derived workspace |
| GET | `/api/runs/[id]` | `readWorkspace`; database query scoped by workspace and run ID |
| GET | `/api/settings/health` | `readWorkspace`; corpus readiness scoped by workspace |

There are no current global/non-workspace route exclusions. Fixed-corpus reads
still resolve context because public-demo availability is a deployment-mode
decision, not an unauthenticated route bypass.

## Files changed

- Retrofitted every file under `app/api/**/route.ts`.
- Added `requirePermission` and authorized rate-limit identities in
  `lib/api/safety.ts`.
- Scoped report, report-by-run, Deal-analysis, and run-ID repository reads in
  `db/repositories/intelligence.ts`, `db/repositories/runs.ts`, and
  `db/client.ts`.
- Replaced document tokens with the exact signed
  `PrivateSourceCapability` payload in `lib/storage/service.ts` and carried the
  authorized context through `lib/corpus/service.ts`.
- Added public serializers for run and uploaded-source records under
  `lib/runs/public.ts` and `lib/uploads/public.ts`.
- Added the complete authorization matrix and updated affected integration and
  unit fixtures.

## RED evidence

- Initial authorization matrix:
  `node --import tsx --test tests/integration/api-authorization.test.ts`
  produced 29 tests: 28 failed and 1 passed. Failures covered missing product
  gates, public upload/import/reset, unscoped report/run reads, uploaded-source
  access, and reset.
- Exact private capability and authorized rate-limit tests failed against the
  legacy document-ID token and IP-only identity.
- A repository boundary test proved the Supabase run-ID query omitted
  `workspace_id`.
- Serializer mutation tests proved run leases/worker diagnostics,
  uploaded-source object/failure details, and XTrace provider errors were
  exposed before sanitization.

## GREEN and regressions

- Authorization matrix: 33/33 passed.
- Required focused route/storage regression command: passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed with zero warnings.
- Full `npm test` (with loopback permission for the two Chat mock servers):
  318 tests, 317 passed, 0 failed, 1 intentionally skipped.

## Self-review

- No `workspace_demo` remains in route behavior; all repository workspace
  arguments come from `context.workspaceId`.
- Request body, query, header, and cookie workspace selectors are ignored.
- Missing product session is 401; missing/ambiguous membership remains
  fail-closed through the shared Task 2 resolver.
- Public demo can read the fixed non-sensitive corpus and cannot upload,
  confirm, reset, list uploaded sources, receive a private capability, or read
  an uploaded source.
- Report ID, report-by-run ID, Deal analysis, run ID, uploaded-source, private
  capability, and reset negative cases are covered.
- Private capabilities contain only `workspaceId`, `sourceRevisionId`,
  `objectVersion`, `expiresAtEpochSeconds`, and `permission: "read"`; the
  signed payload is validated again on read and matched to request context and
  current object version.
- Product rate-limit identity is derived from the resolved principal and
  workspace. User-provided workspace selectors never enter the key.
- API serializers strip object keys, worker IDs, leases, provider diagnostics,
  and internal failure details. Existing response envelopes and UI-consumed
  shapes remain intact.
- Independent read-only code review found 0 Critical, 0 Important, and 0 Minor
  issues and assessed the change ready to merge.

## Concerns

- The trusted product-session adapter intentionally remains the fail-closed
  Task 2 placeholder, so product happy-path integration still depends on the
  future verified session provider.
- Public-demo reset now returns 403 as explicitly required; any existing public
  reset control must tolerate that deployment policy.

## Review round 1

The rejected independent review of
`6d4350072aee5ece129f5a107ba1d6a57d2aee7a` identified one Critical and three
Important tenant-isolation gaps. This follow-up closes each finding:

- **C1 — composite workspace identity:** memory corpus rows now use injective
  JSON tuple keys rather than delimiter-concatenated strings, and Supabase
  corpus lookup/upsert conflict targets use `(workspace_id,id)`. Migration
  `0008_workspace_composite_identity.sql` changes every affected
  workspace-owned external identity to a composite primary key and replaces
  scalar parent relations with composite workspace foreign keys. It also
  rewrites the report RPC to scope conflict, replacement, and return behavior
  by workspace. Identical company, Deal, evidence, interaction, report,
  analysis, XTrace, and upload IDs can therefore coexist across tenants.
  `source_documents` intentionally remains a global immutable,
  content-addressed catalog; `workspace_documents` is the tenant association.
- **I1 — authenticated product boundary:** all 21 handlers use a server-only
  dependency seam whose production default remains the real
  `resolveRequestContext`. No query, header, cookie, body, or request-derived
  hook can select the injected dependency. The product matrix invokes every
  real handler for a trusted partner, every read handler for an associate, all
  three source mutations for allowed/denied roles, and every handler for zero
  and ambiguous membership failures. Every matrix request carries forged
  query, header, and cookie selectors, and every POST also carries a forged
  JSON/form selector. Adversarial handler tests cover cross-tenant
  report/report-company/run/upload/Deal-analysis IDs, reset preservation for a
  second tenant, and an actually issued private capability replayed with the
  wrong workspace, source revision/path, object version, permission, expiry,
  and route. The rate-limit regression compares exact hashes and proves
  caller-controlled request metadata does not change a trusted
  principal/workspace identity.
- **I2 — mandatory repository scope:** run reads, updates, stages, lease
  renewal, and finish operations require a workspace and always filter or
  validate it. Market-event writes and destructive intelligence resets no
  longer have a demo-workspace default. XTrace job completion and external job
  and memory identities are also workspace-composite. `createXTraceService`
  and the worker ingest stage now require an explicit workspace, and recall is
  rejected when it does not match the service's scoped workspace. The only
  intentionally global operations are explicitly documented worker queue
  claims; every mutation after a claim carries the workspace returned by the
  claimed row.
- **I3 — public extraction projection:** uploaded-document serialization now
  explicitly projects only candidate company name, candidate headline, facts,
  excerpts, and locators. Extractor/provider identity, version, extraction
  timestamp, content hash, byte/character accounting, and truncation metadata
  are excluded. A non-null sentinel preview is exercised through the real
  uploaded-documents handler.

The three untracked duplicate fixtures named `* 2.ts` were compared with their
canonical historical files by content hash, found byte-identical, and removed.
No such duplicate remains.

The first follow-up review then identified three additional Important gaps
(the lower-level XTrace default, incomplete all-handler adversarial coverage,
and migration instructions/tests) plus one Minor delimiter-collision risk.
All four were closed before this commit: XTrace has no default tenant, the
matrix and cross-tenant reset/analysis cases were expanded, the README now
lists migrations `0000` through `0008`, the static cross-statement migration
regex test was replaced with a live legacy-schema/catalog test, and tenant
memory keys use JSON tuple encoding with delimiter-bearing regressions.

The second read-only review found one remaining Important documentation gap
and two Minor hardening gaps. Those are also closed: every README migration
range, including the worker runbook, now ends at `0008`, and the documentation
test rejects any stale `0000`–`0007` range; XTrace trims and then consistently
uses the normalized scoped workspace for search, cache, candidate filtering,
and lineage resolution; and `npm run test:migrations` makes PostgreSQL
migration coverage mandatory for CI/release by failing rather than silently
skipping when a disposable database cannot be created. The final concise
re-review reported no remaining Critical or Important issues and `Ready: Yes`.

### Review-round verification

- Regression tests were observed failing before the corresponding persistence,
  handler, repository, capability, rate-key, and serializer fixes.
- Focused authorization, product-route, storage, run, intelligence, XTrace,
  rate-limit, and memory-identity suite: **197 passed, 0 failed**.
- Required live legacy migration and exact PostgreSQL catalog suite
  (`npm run test:migrations`):
  **2 passed, 0 failed**.
- Full suite with loopback permission and local disposable PostgreSQL:
  **422 tests, 421 passed, 0 failed, 1 intentionally skipped**.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `git diff --check`: passed.
- The committed migration test applies `0000` through `0007`, seeds legacy
  tenant rows, applies `0008`, inserts colliding external IDs for a second
  workspace through both tables and the report RPC, verifies exact catalog
  primary/foreign keys, and proves a mismatched parent is rejected.
- Final read-only re-review found **0 Critical and 0 Important** issues and
  reported `Ready: Yes`. The main task controller will perform the formal
  independent acceptance review of the resulting commit.

### Operational notes

- Migration `0008` takes deterministic `ACCESS EXCLUSIVE` locks and should be
  scheduled in a maintenance window.
- The migration deliberately fails closed if legacy parent/child rows already
  disagree on `workspace_id`; operators must repair those mismatches before
  retrying it.
- The follow-up commit message is
  `fix(security): close tenant isolation review gaps`; its SHA is reported in
  the handoff because a commit cannot embed its own content-derived SHA.
