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
