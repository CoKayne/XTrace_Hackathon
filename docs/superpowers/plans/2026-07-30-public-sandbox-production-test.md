# Public Sandbox Production Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the existing public read-only VSee deployment into a public, no-login, writable testing sandbox that supports safe Reset, TXT/Markdown/PDF/DOCX/PNG/WebP intake, complete source-grounded underwriting, named distilled-framework viewpoints, action drafts, and a verified production scan.

**Architecture:** Keep Sites as the public Web/API process and the Node Worker as a separate durable process sharing one Supabase workspace. Introduce a third explicit `public_sandbox` deployment mode with a server-owned actor and workspace, implement Reset as a generation marker instead of deletion, and extend the existing staged-upload pipeline with bounded Node-only PDF/DOCX parsers and exact evidence locators. Preserve the existing immutable underwriting and distilled-framework pipeline; prove it through one live end-to-end acceptance run before deploying the exact verified commit.

**Tech Stack:** TypeScript 5.9, React 19, vinext/Next route handlers, Node 22, PostgreSQL/Supabase REST and RPC, Supabase private object storage, Anthropic Claude, XTrace Memory Manager, `unpdf@1.8.0`, `mammoth@1.12.0`, Node test runner, Sites.

## Global Constraints

- The production Sites URL remains public and requires no login.
- The production Sites environment uses `VSEE_DEPLOYMENT_MODE=public_sandbox`.
- `public_demo` remains anonymous, synthetic, and read-only.
- `product` remains authenticated and membership-authorized; sandbox changes must not weaken it.
- The sandbox resolves only the server-configured `DEMO_WORKSPACE_ID`; browser input cannot select a workspace.
- A persistent warning reads `PUBLIC TEST SANDBOX — Do not upload confidential or real customer data.`
- Reset creates a clean default testing view and never deletes immutable investment, source, framework, XTrace, underwriting, or action-draft history.
- Reset returns HTTP 409 while a scan is queued or running.
- Runtime uploads accept only `.txt`, `.md`, `.pdf`, `.docx`, `.png`, and `.webp`.
- Runtime uploads reject `.jpg`, `.jpeg`, `.gif`, legacy `.doc`, audio, and video.
- The per-file limit is exactly 12 MiB.
- PDF/DOCX parsers load only inside the Node Worker and must not enter the Sites/Cloudflare Web bundle.
- Text-layer PDF evidence retains the exact one-based page; scanned/image-only PDFs fail honestly in this release.
- Upload and extraction never mutate a Deal or XTrace; explicit company/Deal confirmation remains mandatory.
- External actions remain drafts only; the system sends no Email/SMS and publishes no LinkedIn content.
- Named distilled-framework output is a public-source advisory lens, not impersonation, endorsement, or reconstructed private chain of thought.
- `Invest Candidate` means eligible for human IC review and never executes an investment.
- The private `Fetter Family Cafe.m4a` recording remains untracked.

---

## File and Interface Map

### Deployment and authorization

- `lib/auth/request-context.ts`: owns the three deployment modes, server-owned sandbox actor, sandbox permissions, and durable-workspace mode helper.
- `app/ui-capabilities.ts`: maps authorized request contexts to visible controls.
- `lib/api/safety.ts`: keeps public-sandbox limits keyed to the configured workspace and request origin rather than weakening product principal limits.
- Durable-data routes under `app/api/`: use the durable-workspace helper for `public_sandbox` and `product`, while retaining explicit permission checks.

### Test generations and Reset

- `drizzle/0017_public_sandbox_test_generations.sql`: adds the reset marker, market-event observation time, and controlled Reset RPC.
- `db/repositories/test-generations.ts`: memory and Supabase implementations for reading and advancing the current test generation.
- `db/repositories/intelligence.ts`: records `observed_at` and filters default market/report lists after the marker.
- `db/client.ts` and `db/repositories/runs.ts`: filter the default run list after the marker without changing direct run lookup.
- `app/api/demo/reset/route.ts`: refuses active scans and advances the marker.
- `app/page.tsx` and `app/vsee.css`: warning banner, confirmation dialog, and clean client-state reload.

### Upload formats and extraction

- `lib/uploads/service.ts`: exact extension/MIME allowlist and shared upload limits.
- `lib/uploads/file-validation.ts`: strict UTF-8 and lightweight signature checks before storage.
- `db/repositories/uploaded-documents.ts`: PDF locator and extractor metadata types.
- `worker/extract-upload.ts`: dynamically loaded PDF/DOCX parsing, segment-aware exact excerpt location, and image transcription.
- `lib/uploads/confirmation.ts`: converts the extraction locator to canonical evidence without forcing every document to page 1.
- `app/source-upload-flow.tsx`: exact browser accept list and explanatory copy.
- `package.json` and `package-lock.json`: exact Node-only parser dependencies.

### Underwriting and release acceptance

- `worker/runner.ts`: retains the canonical research-framework catalog and complete source-grounded underwriting pipeline.
- `lib/underwriting/frameworks/research-loader.ts`: canonical 20-pack authorization boundary.
- `lib/underwriting/frameworks/claude-lens.ts`: independent evidence-bounded advisory analysis.
- `app/underwriting-detail.tsx`: named viewpoints, provenance, support, counterevidence, unknowns, limitations, confidence, and disagreements.
- `docs/demo-runbook.md`: no-login sandbox operation, migration, Worker, scan, Reset, and rollback instructions.

---

### Task 1: Add the explicit public-sandbox authorization mode

**Files:**
- Modify: `lib/auth/request-context.ts`
- Modify: `app/ui-capabilities.ts`
- Modify: `lib/api/safety.ts`
- Modify: `app/api/runs/route.ts`
- Modify: `app/api/reports/[id]/route.ts`
- Modify: `app/api/reports/[id]/underwriting/[dealId]/route.ts`
- Modify: `app/api/deals/route.ts`
- Modify: `app/api/deals/[id]/route.ts`
- Modify: `app/api/overview/route.ts`
- Modify: `app/api/search/route.ts`
- Modify: `app/api/chat/route.ts`
- Modify: `app/api/action-drafts/route.ts`
- Modify: `app/api/action-drafts/[id]/route.ts`
- Modify: `app/api/documents/[id]/route.ts`
- Modify: `app/api/documents/[id]/access/route.ts`
- Modify: `app/api/uploads/[id]/confirm/route.ts`
- Modify: `app/api/settings/health/route.ts`
- Modify: `.env.example`
- Test: `tests/unit/request-context.test.ts`
- Test: `tests/unit/ui-hardening.test.ts`
- Test: `tests/unit/api-safety.test.ts`
- Test: `tests/integration/api-authorization.test.ts`
- Test: `tests/integration/product-route-authorization.test.ts`

**Interfaces:**
- Produces: `DeploymentMode = "public_demo" | "public_sandbox" | "product"`.
- Produces: `isDurableWorkspaceMode(mode: DeploymentMode): boolean`.
- Produces: `PUBLIC_SANDBOX_ACTOR_ID = "system:public-sandbox"`.
- Produces: a `public_sandbox` request context with the configured workspace, stable non-human principal, private-source read, source mutation, policy management, and no framework administration.
- Consumes: every existing route permission check and repository interface unchanged.

- [ ] **Step 1: Write failing request-context and capability tests**

Add tests that prove the workspace is server-owned, the stable actor is used, all testing capabilities are enabled, and product mode still rejects unauthenticated/non-member callers:

```ts
test("public sandbox resolves one server-owned writable workspace", async () => {
  const context = await resolveRequestContext(
    new Request("https://vsee.test/api/runs", {
      headers: { "x-workspace-id": "attacker_workspace" },
    }),
    {
      environment: {
        VSEE_DEPLOYMENT_MODE: "public_sandbox",
        DEMO_WORKSPACE_ID: "workspace_sandbox",
      },
    },
  );
  assert.equal(context.mode, "public_sandbox");
  assert.equal(context.workspaceId, "workspace_sandbox");
  assert.equal(context.principal?.userId, "system:public-sandbox");
  assert.deepEqual(context.permissions, {
    readWorkspace: true,
    readPrivateSources: true,
    mutateSources: true,
    managePolicy: true,
    administerFrameworks: false,
  });
  assert.deepEqual(uiSessionForContext(context).capabilities, {
    runScans: true,
    resetDemo: true,
    uploadSources: true,
    confirmUploads: true,
    manageFundPolicy: true,
    saveActionDrafts: true,
  });
});
```

- [ ] **Step 2: Run the focused tests and verify the new mode fails**

Run:

```bash
node --import tsx --test --test-concurrency=1 \
  --test-name-pattern="public sandbox|server-owned writable workspace" \
  tests/unit/request-context.test.ts tests/unit/ui-hardening.test.ts
```

Expected: FAIL because `public_sandbox` is not in `DeploymentMode` and the current capability map enables only `product`.

- [ ] **Step 3: Implement the request context and reusable durable-mode helper**

Use one stable non-human principal and do not read workspace or actor identity from the request:

```ts
export type DeploymentMode = "public_demo" | "public_sandbox" | "product";
export const PUBLIC_SANDBOX_ACTOR_ID = "system:public-sandbox";

export function isDurableWorkspaceMode(mode: DeploymentMode): boolean {
  return mode === "public_sandbox" || mode === "product";
}

if (mode === "public_sandbox") {
  const workspaceId = environment.DEMO_WORKSPACE_ID?.trim();
  if (!workspaceId) throw new Error("INTERNAL_ERROR");
  return {
    mode,
    principal: {
      userId: PUBLIC_SANDBOX_ACTOR_ID,
      email: "public-sandbox@invalid.local",
    },
    workspaceId,
    role: "sandbox",
    permissions: {
      readWorkspace: true,
      readPrivateSources: true,
      mutateSources: true,
      managePolicy: true,
      administerFrameworks: false,
    },
  };
}
```

Update `uiSessionForContext()` so `public_sandbox` receives the six testing capabilities and `public_demo` remains all false. Keep Reset false in authenticated `product` until a separate product-owner UX is designed.

- [ ] **Step 4: Replace route-level `product` gates with the durable-mode helper only where the route already requires the corresponding permission**

For example, run creation becomes:

```ts
requirePermission(context, "readWorkspace");
if (!isDurableWorkspaceMode(context.mode)) throw new Error("FORBIDDEN");
```

Underwriting report reads, Deals, Overview, Search, Chat, document access, action drafts, and source confirmation must use durable repositories in `public_sandbox`. Keep all existing workspace scoping and permission checks. Do not change `public_demo` fixture behavior.

- [ ] **Step 5: Run authorization and capability tests**

Run:

```bash
node --import tsx --test --test-concurrency=1 \
  tests/unit/request-context.test.ts \
  tests/unit/ui-hardening.test.ts \
  tests/unit/api-safety.test.ts \
  tests/integration/api-authorization.test.ts \
  tests/integration/product-route-authorization.test.ts
```

Expected: PASS with anonymous `public_demo` read-only, anonymous `public_sandbox` writable only in its configured workspace, and authenticated `product` unchanged.

- [ ] **Step 6: Commit the authorization slice**

```bash
git add lib/auth/request-context.ts app/ui-capabilities.ts lib/api/safety.ts \
  app/api .env.example tests/unit/request-context.test.ts \
  tests/unit/ui-hardening.test.ts tests/unit/api-safety.test.ts \
  tests/integration/api-authorization.test.ts \
  tests/integration/product-route-authorization.test.ts
git commit -m "feat: add public sandbox deployment mode"
```

---

### Task 2: Add non-destructive test generations and Reset persistence

**Files:**
- Create: `drizzle/0017_public_sandbox_test_generations.sql`
- Modify: `drizzle/meta/_journal.json`
- Create: `db/repositories/test-generations.ts`
- Modify: `db/schema.ts`
- Modify: `db/client.ts`
- Modify: `db/repositories/runs.ts`
- Modify: `db/repositories/intelligence.ts`
- Modify: `app/api/runs/route.ts`
- Modify: `app/api/reports/route.ts`
- Modify: `app/api/market/events/route.ts`
- Test: `tests/integration/public-sandbox-reset-migration.test.ts`
- Test: `tests/unit/test-generations.test.ts`
- Test: `tests/unit/intelligence-repository.test.ts`
- Test: `tests/unit/runs-repository.test.ts`

**Interfaces:**
- Produces: `TestGenerationRepository.currentResetAt(workspaceId): Promise<string | null>`.
- Produces: `TestGenerationRepository.advance(workspaceId): Promise<{ resetAt: string }>`.
- Produces: `filterAfterReset<T extends { createdAt: string }>(rows, resetAt)`.
- Produces: `market_events.observed_at timestamptz`.
- Consumes: existing direct `getReport`, `getReportByRunId`, and `getRun` interfaces unchanged so immutable historical permalinks remain readable.

- [ ] **Step 1: Write failing migration tests**

The migration test must apply `0000` through `0017`, insert one old report/event/run plus immutable underwriting children, call Reset, and prove only the marker changes:

```ts
const resetResult = JSON.parse(sqlScalar(database, `
  select public.reset_test_view(
    'workspace_reset',
    'system:public-sandbox'
  )::text
`));
assert.equal(resetResult.reset, true);
assert.ok(resetResult.resetAt);
assert.equal(sqlScalar(database, `
  select count(*) from public.intelligence_reports
  where workspace_id = 'workspace_reset'
`), "1");
assert.equal(sqlScalar(database, `
  select count(*) from public.underwriting_batches
  where workspace_id = 'workspace_reset'
`), "1");
```

Add a second case with a queued run and assert the RPC returns
`{"reset":false,"reason":"active_scan"}` without changing the current marker.

- [ ] **Step 2: Run the migration test and verify it fails**

Run:

```bash
REQUIRE_POSTGRES_MIGRATION_TESTS=1 node --import tsx --test \
  tests/integration/public-sandbox-reset-migration.test.ts
```

Expected: FAIL because migration `0017`, `observed_at`, and `reset_test_view` do not exist.

- [ ] **Step 3: Add the migration and restricted RPC**

The migration must use the following shape:

```sql
begin;

create table if not exists public.workspace_test_generations (
  workspace_id text primary key
    references public.workspaces(id) on delete cascade,
  reset_at timestamptz not null default now(),
  updated_by text not null,
  constraint workspace_test_generations_updated_by_check
    check (btrim(updated_by) <> '')
);

alter table public.market_events
  add column if not exists observed_at timestamptz not null default now();

create or replace function public.reset_test_view(
  p_workspace_id text,
  p_actor_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  marker timestamptz := clock_timestamp();
begin
  if exists (
    select 1 from public.scan_runs
    where workspace_id = p_workspace_id
      and status in ('queued', 'running')
  ) then
    return jsonb_build_object(
      'reset', false,
      'reason', 'active_scan'
    );
  end if;
  insert into public.workspace_test_generations (
    workspace_id, reset_at, updated_by
  ) values (p_workspace_id, marker, p_actor_id)
  on conflict (workspace_id) do update
    set reset_at = excluded.reset_at,
        updated_by = excluded.updated_by;
  return jsonb_build_object(
    'reset', true,
    'resetAt', public.canonical_utc_iso_milliseconds(marker)
  );
end;
$$;

revoke all on function public.reset_test_view(text, text) from public;
revoke all on function public.reset_test_view(text, text) from anon;
revoke all on function public.reset_test_view(text, text) from authenticated;
grant execute on function public.reset_test_view(text, text) to service_role;

commit;
```

Append the exact `0017_public_sandbox_test_generations` entry to `drizzle/meta/_journal.json` and add matching Drizzle declarations.

- [ ] **Step 4: Implement memory and Supabase generation repositories**

The repository must not expose deletion:

```ts
export interface TestGenerationRepository {
  currentResetAt(workspaceId: string): Promise<string | null>;
  advance(input: {
    workspaceId: string;
    actorId: string;
  }): Promise<{ resetAt: string }>;
}
```

The Supabase implementation reads `workspace_test_generations` and calls `/rpc/reset_test_view`. The memory implementation stores one ISO timestamp per workspace and accepts an injected clock for deterministic tests.
Both implementations throw the dedicated `ActiveScanResetError` when the
controlled operation reports `reason === "active_scan"`; the public route maps
only that typed error to HTTP 409.

- [ ] **Step 5: Filter only default lists and refresh event observation time**

`saveMarketEvents()` must write `observed_at` for every accepted event on every scan. The default run, report, and market-event list routes read the current marker and return only rows after it. Direct report/run lookup remains unfiltered.

Use strict comparison:

```ts
export function afterReset(value: string, resetAt: string | null): boolean {
  return resetAt === null || new Date(value).getTime() > new Date(resetAt).getTime();
}
```

For market events compare `observedAt`; for reports and runs compare `createdAt`.

- [ ] **Step 6: Run repository and migration tests**

Run:

```bash
node --import tsx --test --test-concurrency=1 \
  tests/unit/test-generations.test.ts \
  tests/unit/intelligence-repository.test.ts \
  tests/unit/runs-repository.test.ts
REQUIRE_POSTGRES_MIGRATION_TESTS=1 node --import tsx --test \
  tests/integration/public-sandbox-reset-migration.test.ts
```

Expected: PASS; immutable rows survive Reset and old rows disappear only from default lists.

- [ ] **Step 7: Commit the persistence slice**

```bash
git add drizzle/0017_public_sandbox_test_generations.sql \
  drizzle/meta/_journal.json db/schema.ts db/client.ts \
  db/repositories/test-generations.ts db/repositories/runs.ts \
  db/repositories/intelligence.ts app/api/runs/route.ts \
  app/api/reports/route.ts app/api/market/events/route.ts tests
git commit -m "feat: add non-destructive test view reset"
```

---

### Task 3: Restore Reset in the UI with an explicit safety contract

**Files:**
- Modify: `app/api/demo/reset/route.ts`
- Modify: `app/page.tsx`
- Modify: `app/vsee.css`
- Test: `tests/integration/api-authorization.test.ts`
- Test: `tests/unit/ui-hardening.test.ts`

**Interfaces:**
- Consumes: `TestGenerationRepository.advance()`.
- Consumes: `UiCapabilities.resetDemo`.
- Produces: `POST /api/demo/reset` response `{ reset: true, resetAt: string }`.
- Produces: `ResetTestViewDialog` UI behavior inside `app/page.tsx`.

- [ ] **Step 1: Write failing route and UI tests**

Cover the active-run conflict, immutable wording, public warning, and clean-state reload:

```ts
assert.match(page, /RESET TEST VIEW/);
assert.match(page, /does not delete Deals, Sources, XTrace memory, Fund Policy, underwriting artifacts, or action drafts/);
assert.match(page, /PUBLIC TEST SANDBOX/);
assert.match(page, /Do not upload confidential or real customer data/);
```

The route test must inject a queued run and expect status 409 without advancing the marker.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```bash
node --import tsx --test --test-concurrency=1 \
  tests/integration/api-authorization.test.ts \
  tests/unit/ui-hardening.test.ts
```

Expected: FAIL because the UI still renders `RESET DISABLED` and the route still deletes scan products.

- [ ] **Step 3: Replace deletion with marker advancement**

The Reset route must:

1. resolve the server-owned request context;
2. require `mutateSources`;
3. require `context.mode === "public_sandbox"`;
4. retain the existing rate limit;
5. query for queued/running runs and return fixed 409 JSON when present;
6. call `advance({ workspaceId, actorId: context.principal!.userId })`;
7. map `ActiveScanResetError` from the atomic RPC to the same fixed 409
   response, closing the precheck/RPC race;
8. return the marker.

Do not call `resetScanProducts()` or any DELETE endpoint.

- [ ] **Step 4: Add the warning banner and confirmation dialog**

Render the persistent banner only in `public_sandbox`:

```tsx
{uiSession.deploymentMode === "public_sandbox" && (
  <div className="vsee-sandbox-warning" role="status">
    PUBLIC TEST SANDBOX — Do not upload confidential or real customer data.
  </div>
)}
```

The top-bar button reads `RESET TEST VIEW`. The dialog has `Cancel` and `RESET CURRENT VIEW`, explains preserved data verbatim, disables submission while busy, and shows route errors without closing.

- [ ] **Step 5: Clear only client view state after a successful Reset**

After the route returns:

```ts
setFocusedReportId(null);
setActiveRunId(null);
setActiveRun(null);
setScanProgressOpen(false);
setReportDraft(null);
setError("");
window.history.replaceState({}, "", window.location.pathname);
await load();
setNotice("Current test view reset. Durable evidence and analysis history were preserved.");
```

Do not clear Deals, uploads, Fund Policy, XTrace status, or selected memory mode.

- [ ] **Step 6: Run Reset/UI tests and commit**

Run:

```bash
node --import tsx --test --test-concurrency=1 \
  tests/integration/api-authorization.test.ts \
  tests/unit/ui-hardening.test.ts
```

Expected: PASS.

Commit:

```bash
git add app/api/demo/reset/route.ts app/page.tsx app/vsee.css \
  tests/integration/api-authorization.test.ts tests/unit/ui-hardening.test.ts
git commit -m "feat: restore safe sandbox reset"
```

---

### Task 4: Enforce the exact upload allowlist and signatures

**Files:**
- Modify: `lib/uploads/service.ts`
- Create: `lib/uploads/file-validation.ts`
- Modify: `app/api/uploads/route.ts`
- Modify: `app/source-upload-flow.tsx`
- Test: `tests/unit/upload-staging-lifecycle.test.ts`
- Test: `tests/unit/upload-extraction.test.ts`
- Test: `tests/unit/ui-hardening.test.ts`

**Interfaces:**
- Produces: `RuntimeUploadContentType` for six exact MIME types.
- Produces: `validateUploadBytes({ filename, contentType, bytes }): void`.
- Consumes: existing `MAX_UPLOAD_BYTES = 12 * 1024 * 1024`.

- [ ] **Step 1: Write the failing allowlist and signature tests**

Use table-driven cases:

```ts
for (const [filename, reportedType, expected] of [
  ["memo.txt", "text/plain", "text/plain"],
  ["notes.md", "text/markdown", "text/markdown"],
  ["deck.pdf", "application/pdf", "application/pdf"],
  ["memo.docx", "application/octet-stream", DOCX_CONTENT_TYPE],
  ["chart.png", "image/png", "image/png"],
  ["chart.webp", "image/webp", "image/webp"],
] as const) {
  assert.equal(resolveRuntimeUploadContentType({ filename, reportedType }), expected);
}

for (const filename of [
  "photo.jpg", "photo.jpeg", "animation.gif", "legacy.doc",
  "meeting.m4a", "clip.mp4",
]) {
  assert.throws(() => resolveRuntimeUploadContentType({ filename }));
}
```

Add malformed `%PDF`, PNG, WebP, DOCX ZIP, and invalid UTF-8 cases and prove object storage is never called.

- [ ] **Step 2: Run focused upload tests and verify they fail**

Run:

```bash
node --import tsx --test --test-concurrency=1 \
  tests/unit/upload-staging-lifecycle.test.ts \
  tests/unit/upload-extraction.test.ts \
  tests/unit/ui-hardening.test.ts
```

Expected: FAIL because PDF/DOCX are rejected and JPEG/GIF are still accepted.

- [ ] **Step 3: Replace the allowlist**

Use exact MIME values:

```ts
export const DOCX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const EXTENSION_CONTENT_TYPES = {
  txt: "text/plain",
  md: "text/markdown",
  pdf: "application/pdf",
  docx: DOCX_CONTENT_TYPE,
  png: "image/png",
  webp: "image/webp",
} as const;
```

Recognize `application/octet-stream` only as an allowed reported type for an extension that resolves unambiguously. Reject a recognized contradictory MIME such as `image/png` on `deck.pdf`.

- [ ] **Step 4: Implement lightweight byte validation before storage**

Validate:

```ts
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
```

- PDF starts with `%PDF-`.
- PNG has the full eight-byte signature.
- WebP starts with `RIFF`, has at least 12 bytes, and bytes 8–11 are `WEBP`.
- DOCX starts with a ZIP local-file signature `PK\x03\x04`; the Worker performs the deeper Office-package check.
- TXT/Markdown decode with `new TextDecoder("utf-8", { fatal: true })` and contain non-whitespace text.

Call `validateUploadBytes()` after reading bytes and before checksum/storage.

- [ ] **Step 5: Update browser copy and accept list**

Use:

```tsx
accept=".txt,.md,.pdf,.docx,.png,.webp"
```

The explanatory copy reads `TXT, Markdown, PDF, DOCX, PNG, or WebP · 12 MB maximum`. It must not mention JPEG, GIF, or audio.

- [ ] **Step 6: Run upload tests and commit**

Run:

```bash
node --import tsx --test --test-concurrency=1 \
  tests/unit/upload-staging-lifecycle.test.ts \
  tests/unit/upload-extraction.test.ts \
  tests/unit/ui-hardening.test.ts
```

Expected: PASS.

Commit:

```bash
git add lib/uploads/service.ts lib/uploads/file-validation.ts \
  app/api/uploads/route.ts app/source-upload-flow.tsx \
  tests/unit/upload-staging-lifecycle.test.ts \
  tests/unit/upload-extraction.test.ts tests/unit/ui-hardening.test.ts
git commit -m "feat: enforce production upload formats"
```

---

### Task 5: Add bounded page-aware PDF and DOCX extraction

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `db/repositories/uploaded-documents.ts`
- Modify: `worker/extract-upload.ts`
- Modify: `lib/uploads/confirmation.ts`
- Modify: `lib/contracts/evidence.ts`
- Test: `tests/fixtures/uploads/two-page-text.pdf`
- Test: `tests/fixtures/uploads/sample-memo.docx`
- Test: `tests/unit/upload-extraction.test.ts`
- Test: `tests/unit/upload-confirmation.test.ts`
- Test: `tests/integration/upload-confirmation-flow.test.ts`
- Test: `tests/unit/integration-transport-boundaries.test.ts`

**Interfaces:**
- Produces: `ExtractedUploadContent` with complete text, ordered segments, extractor ID, and exact locator.
- Extends: `ExtractionPreview.facts[].locator` with `{ kind: "pdf_page"; page: number; excerpt: string }`.
- Extends: extractor IDs with `pdf_text_v1` and `docx_text_v1`.
- Consumes: `unpdf@1.8.0` and `mammoth@1.12.0` through dynamic imports inside `worker/extract-upload.ts`.

- [ ] **Step 1: Add real fixture-based failing tests**

Generate and commit a two-page PDF whose unique second-page sentence is:

```text
Second-page evidence: Acme signed three enterprise customers.
```

Generate and commit a DOCX whose exact sentence is:

```text
Acme reported annual recurring revenue of USD 2 million.
```

Assert:

```ts
assert.deepEqual(
  preview.facts.find((fact) => fact.excerpt?.startsWith("Second-page"))?.locator,
  {
    kind: "pdf_page",
    page: 2,
    excerpt: "Second-page evidence: Acme signed three enterprise customers.",
  },
);
assert.equal(preview.extractionMetadata.truncated, false);
```

Add tests for a textless PDF, malformed DOCX, password-protected PDF, PDF over 100 pages, and extracted text over 2,000,000 characters. Each must fail with a fixed non-secret reason instead of returning partial evidence.

- [ ] **Step 2: Install exact parser versions and verify the tests fail at behavior**

Run:

```bash
npm install --save-exact unpdf@1.8.0 mammoth@1.12.0
node --import tsx --test --test-concurrency=1 \
  tests/unit/upload-extraction.test.ts \
  tests/unit/upload-confirmation.test.ts
```

Expected: tests reach the extractor and FAIL because PDF/DOCX parsing and `pdf_page` locators are not implemented.

- [ ] **Step 3: Add extraction content and segment types**

Use:

```ts
interface ExtractedSegment {
  text: string;
  start: number;
  end: number;
  locator:
    | { kind: "text_range" }
    | { kind: "pdf_page"; page: number };
}

interface ExtractedUploadContent {
  text: string;
  segments: ExtractedSegment[];
  extractorId:
    | "plain_text_v1"
    | "pdf_text_v1"
    | "docx_text_v1"
    | "claude_vision_v1";
  modelDerived: boolean;
}
```

Join PDF pages in order with `\n\n` while tracking each page’s exact start/end. TXT/Markdown/DOCX use one text segment. Images use model-derived content and retain the image locator behavior.

- [ ] **Step 4: Implement bounded dynamic parsers**

For PDF:

```ts
const { extractText, getDocumentProxy } = await import("unpdf");
const pdf = await getDocumentProxy(new Uint8Array(input.bytes));
if (pdf.numPages > 100) throw new UnsupportedDocumentError("PDF exceeds 100 pages.");
const { text } = await extractText(pdf, { mergePages: false });
const pages = Array.isArray(text) ? text : [text];
```

Reject encrypted/password-protected files, zero-readable-text files, or outputs above 2,000,000 characters. Do not call vision fallback for scanned PDFs in this release.

For DOCX:

```ts
const mammoth = await import("mammoth");
const result = await mammoth.extractRawText({ buffer: Buffer.from(input.bytes) });
```

Before extraction, verify the ZIP central directory includes `[Content_Types].xml` and `word/document.xml`, no entry escapes the archive root, no entry count exceeds 2,000, and declared uncompressed content does not exceed 64 MiB.

Implement the guard without decompressing entries first:

```ts
function inspectDocxCentralDirectory(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findSignatureFromEnd(view, 0x06054b50, 65_557);
  if (eocd < 0) throw new UnsupportedDocumentError("DOCX archive is malformed.");
  const entryCount = view.getUint16(eocd + 10, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (entryCount === 0xffff || centralOffset === 0xffffffff || entryCount > 2_000) {
    throw new UnsupportedDocumentError("DOCX archive exceeds supported limits.");
  }
  let offset = centralOffset;
  let uncompressedBytes = 0;
  const names = new Set<string>();
  for (let index = 0; index < entryCount; index += 1) {
    if (
      offset < 0
      || offset + 46 > bytes.byteLength
      || view.getUint32(offset, true) !== 0x02014b50
    ) {
      throw new UnsupportedDocumentError("DOCX archive is malformed.");
    }
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > bytes.byteLength || size === 0xffffffff) {
      throw new UnsupportedDocumentError("DOCX archive is malformed.");
    }
    const name = new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(nameStart, nameEnd),
    );
    if (
      name.startsWith("/")
      || name.split("/").some((part) => part === "..")
      || name.includes("\\")
    ) {
      throw new UnsupportedDocumentError("DOCX archive contains an unsafe path.");
    }
    names.add(name);
    uncompressedBytes += size;
    if (uncompressedBytes > 64 * 1024 * 1024) {
      throw new UnsupportedDocumentError("DOCX archive exceeds 64 MiB expanded.");
    }
    offset = nameEnd + extraLength + commentLength;
  }
  if (!names.has("[Content_Types].xml") || !names.has("word/document.xml")) {
    throw new UnsupportedDocumentError("DOCX Office document parts are missing.");
  }
}
```

`findSignatureFromEnd()` searches only the maximum EOCD comment window plus
the 22-byte EOCD record, rejects an out-of-range record, and never allocates
from archive-declared lengths.

- [ ] **Step 5: Locate exact excerpts in the correct segment**

After Claude returns an exact excerpt, find the exact contiguous occurrence in `ExtractedUploadContent.text`. Require the entire occurrence to fit in one segment. Produce:

```ts
segment.locator.kind === "pdf_page"
  ? { kind: "pdf_page", page: segment.locator.page, excerpt: fact.excerpt }
  : { kind: "text_range", start, end };
```

Drop a fact whose excerpt is absent, crosses page boundaries, or is model-derived without an exact-locator contract. Keep image-derived facts labeled with the image locator and no byte-exact excerpt.

- [ ] **Step 6: Preserve the locator through confirmation**

Replace the hard-coded `page: 1` with:

```ts
page: fact.locator.kind === "pdf_page" ? fact.locator.page : 1,
```

`evidenceLocator()` must pass through `pdf_page`, text-range, and image variants without recasting a DOCX/TXT locator as a PDF page.

- [ ] **Step 7: Prove Node-only parser boundaries**

Extend the transport-boundary test to inspect the production Web bundle and assert it contains neither `mammoth` nor `unpdf`. Confirm `worker/extract-upload.ts` contains both dynamic import strings.

Run:

```bash
node --import tsx --test --test-concurrency=1 \
  tests/unit/upload-extraction.test.ts \
  tests/unit/upload-confirmation.test.ts \
  tests/integration/upload-confirmation-flow.test.ts \
  tests/unit/integration-transport-boundaries.test.ts
npm run build
```

Expected: all tests and the production build PASS; the Web bundle contains no parser package.

- [ ] **Step 8: Commit the extraction slice**

```bash
git add package.json package-lock.json db/repositories/uploaded-documents.ts \
  worker/extract-upload.ts lib/uploads/confirmation.ts \
  lib/contracts/evidence.ts tests/fixtures/uploads \
  tests/unit/upload-extraction.test.ts tests/unit/upload-confirmation.test.ts \
  tests/integration/upload-confirmation-flow.test.ts \
  tests/unit/integration-transport-boundaries.test.ts
git commit -m "feat: extract PDF and DOCX evidence with lineage"
```

---

### Task 6: Expose the complete durable underwriting and named advisory report in public sandbox

**Files:**
- Modify: `app/page.tsx`
- Modify: `app/underwriting-detail.tsx`
- Modify: `app/underwriting-summary.tsx`
- Modify: `app/company-intelligence.tsx`
- Test: `tests/unit/framework-context-runtime.test.ts`
- Test: `tests/unit/research-framework-loader.test.ts`
- Test: `tests/unit/framework-advisory.test.ts`
- Test: `tests/unit/underwriting-view-model.test.ts`
- Test: `tests/unit/ui-hardening.test.ts`
- Test: `tests/integration/process-run-underwriting.test.ts`
- Test: `tests/integration/underwriting-report-route.test.ts`

**Interfaces:**
- Consumes: canonical research catalog with exactly 20 packs, 199 authored cards, 270 sources, 180 eligible cards, and 19 excluded cards.
- Consumes: `ContextAwareFrameworkLensResolver`.
- Produces: public-sandbox report UI with each applicable named advisory pack’s independent judgment and exact public-source lineage.
- Preserves: formal deterministic decision engine and `formalDecisionWeight = "0"` for named advisory lenses.

- [ ] **Step 1: Add a production-path acceptance test for named viewpoints**

The test must load the canonical catalog, run the real context-aware resolver with a deterministic Claude stub, persist the resulting bundle, read it through the report route, and render the UI. Assert:

```ts
assert.equal(catalog.stats.packCount, 20);
assert.equal(catalog.stats.eligibleCardCount, 180);
assert.ok(detail.judgments.some((item) =>
  item.frameworkMetadata?.packId === "peter_thiel_public_frameworks_v0_1"
));
assert.match(html, /NAMED ADVISORY/);
assert.match(html, /Support/);
assert.match(html, /Counterevidence/);
assert.match(html, /Unknowns/);
assert.match(html, /Limitations/);
assert.match(html, /Independent disagreements/);
assert.match(html, /Exact source lineage/);
```

Also assert that each named judgment’s Evidence Pack IDs exist and its public source URL/locator is rendered.

- [ ] **Step 2: Run the named-viewpoint acceptance tests**

Run:

```bash
node --import tsx --test --test-concurrency=1 \
  tests/unit/framework-context-runtime.test.ts \
  tests/unit/research-framework-loader.test.ts \
  tests/unit/framework-advisory.test.ts \
  tests/unit/underwriting-view-model.test.ts \
  tests/integration/process-run-underwriting.test.ts \
  tests/integration/underwriting-report-route.test.ts
```

Expected before UI mode changes: runtime framework tests PASS, while public-sandbox display assertions FAIL because the page enables detailed underwriting only for `product`.

- [ ] **Step 3: Treat public sandbox as a durable underwriting UI**

Use `isDurableWorkspaceMode()` or a UI-local equivalent derived from the trusted health response for copy and rendering. Required changes include:

```tsx
underwritingEnabled={deploymentMode !== "public_demo"}
showDemoProfiles={deploymentMode === "public_demo"}
```

All `deploymentMode === "product"` branches that merely choose durable Deals, Source Revisions, upload UX, full report copy, or search behavior must include `public_sandbox`. Branches related to authenticated membership remain product-only.

- [ ] **Step 4: Keep every named viewpoint independent and sourced**

Do not average conflicting lenses or turn a named advisory conclusion into a decision-engine input. Preserve:

- pack name, ID, version, cutoff, and attribution;
- support and counterevidence;
- Evidence Pack IDs;
- unknowns and public limitations;
- confidence dimensions;
- exact retained public source URL and locator;
- explicit pairwise disagreements.

Render the existing “no endorsement” and “no private chain of thought” product contract in the framework provenance disclosure.

- [ ] **Step 5: Run complete framework/report tests and commit**

Run:

```bash
node --import tsx --test --test-concurrency=1 \
  tests/unit/framework-context-runtime.test.ts \
  tests/unit/research-framework-loader.test.ts \
  tests/unit/framework-advisory.test.ts \
  tests/unit/underwriting-view-model.test.ts \
  tests/unit/ui-hardening.test.ts \
  tests/integration/process-run-underwriting.test.ts \
  tests/integration/underwriting-report-route.test.ts
```

Expected: PASS.

Commit:

```bash
git add app/page.tsx app/underwriting-detail.tsx \
  app/underwriting-summary.tsx app/company-intelligence.tsx tests
git commit -m "feat: expose complete sandbox underwriting reports"
```

---

### Task 7: Add production migration, Worker, and rollback operations

**Files:**
- Modify: `docs/demo-runbook.md`
- Create: `scripts/run-worker-from-keychain.zsh`
- Create: `scripts/apply-production-migrations.zsh`
- Modify: `.gitignore`
- Test: `tests/unit/worker-deployment.test.ts`
- Test: `tests/unit/release-readiness.test.ts`

**Interfaces:**
- Produces: a Worker launcher that reads macOS Keychain services without printing secret values.
- Produces: a sequential migration command that refuses gaps and verifies an exact sentinel after every applied filename.
- Consumes: `npm run worker`, `psql`, the exact deploy commit, and existing Keychain services.

- [ ] **Step 1: Write failing deployment-script tests**

Assert the launcher:

- resolves `vsee-supabase-url`, `vsee-supabase-service-role-key`,
  `vsee-anthropic-api-key`, `vsee-xtrace-api-key`, and
  `vsee-document-url-signing-secret`;
- never contains or echoes secret values;
- exports `VSEE_DEPLOYMENT_MODE=public_sandbox`;
- starts `npm run worker`;
- records logs under ignored `.runtime/`;
- exits before starting when a required secret is missing.

Assert the migration script reads `vsee-supabase-db-url`, verifies the
known-complete `0009` boundary, inventories `0010`–`0017` through exact
database sentinels, uses `ON_ERROR_STOP=1`, and never applies a later migration
while an earlier sentinel is absent.

- [ ] **Step 2: Run the deployment-script tests and verify they fail**

Run:

```bash
node --import tsx --test --test-concurrency=1 \
  tests/unit/worker-deployment.test.ts \
  tests/unit/release-readiness.test.ts
```

Expected: FAIL because the scripts and public-sandbox runbook do not exist.

- [ ] **Step 3: Add the secure Worker launcher**

The launcher must use:

```zsh
#!/bin/zsh
set -euo pipefail
export SUPABASE_URL="$(security find-generic-password -a "$USER" -s "vsee-supabase-url" -w)"
export SUPABASE_SERVICE_ROLE_KEY="$(security find-generic-password -a "$USER" -s "vsee-supabase-service-role-key" -w)"
export ANTHROPIC_API_KEY="$(security find-generic-password -a "$USER" -s "vsee-anthropic-api-key" -w)"
export XTRACE_API_KEY="$(security find-generic-password -a "$USER" -s "vsee-xtrace-api-key" -w)"
export DOCUMENT_URL_SIGNING_SECRET="$(security find-generic-password -a "$USER" -s "vsee-document-url-signing-secret" -w)"
export VSEE_DEPLOYMENT_MODE="public_sandbox"
export DEMO_WORKSPACE_ID="workspace_demo"
export SUPABASE_STORAGE_BUCKET="vsee-demo-sources"
export ANTHROPIC_MODEL="claude-opus-4-8"
export XTRACE_API_BASE_URL="https://api.production.xtrace.ai"
export MARKET_USER_AGENT="VSee VC Intelligence public-sandbox"
export MARKET_OFFICIAL_FEEDS_JSON='[{"id":"sequoia-official","name":"Sequoia Capital official insights","url":"https://www.sequoiacap.com/feed/","publisher":"Sequoia Capital","eventType":"funding","confidence":"medium"},{"id":"lsvp-official","name":"Lightspeed Venture Partners insights","url":"https://lsvp.com/feed/","publisher":"Lightspeed Venture Partners","eventType":"funding","confidence":"medium"}]'
export MARKET_PUBLISHER_FEEDS_JSON='[{"id":"a16z-news","name":"a16z News","url":"https://www.a16z.news/feed","publisher":"Andreessen Horowitz","eventType":"trend","confidence":"medium"},{"id":"marijuana-moment","name":"Marijuana Moment policy news","url":"https://www.marijuanamoment.net/feed/","publisher":"Marijuana Moment","eventType":"regulatory","confidence":"medium"},{"id":"fierce-healthcare","name":"Fierce Healthcare news","url":"https://www.fiercehealthcare.com/rss/xml","publisher":"Fierce Healthcare","eventType":"commercial","confidence":"medium"},{"id":"supply-chain-dive","name":"Supply Chain Dive news","url":"https://www.supplychaindive.com/feeds/news/","publisher":"Supply Chain Dive","eventType":"commercial","confidence":"medium"},{"id":"retail-dive","name":"Retail Dive news","url":"https://www.retaildive.com/feeds/news/","publisher":"Retail Dive","eventType":"commercial","confidence":"medium"}]'
mkdir -p .runtime
exec npm run worker >>.runtime/worker.log 2>&1
```

Do not add an XTrace organization ID requirement for `mmk_` keys.

- [ ] **Step 4: Add the sequential migration launcher**

Read the database URL only from `vsee-supabase-db-url`. Before applying
anything, verify the `0009` boundary with all of:

```sql
select
  to_regclass('public.deals') is not null
  and to_regclass('public.companies') is not null
  and to_regclass('public.deal_source_assignments') is not null
  and to_regprocedure(
    'public.confirm_source_assignment(jsonb)'
  ) is not null;
```

Inventory the forward chain using these sentinels:

| Migration | Complete sentinel |
|---|---|
| `0010` | `public.fund_policy_versions` exists |
| `0011` | `public.underwriting_batches` exists |
| `0012` | `public.source_evidence_items` exists |
| `0013` | `public.uploaded_documents.confirmation_fingerprint` exists |
| `0014` | `public.replace_action_draft_body(text,text,text)` exists |
| `0015` | `candidate_checkpoints_stage_check` contains `framework_catalog` |
| `0016` | `public.source_evidence_items.source_id` exists and is `NOT NULL` |
| `0017` | `public.workspace_test_generations` and `public.reset_test_view(text,text)` exist |

The script fails when it sees a complete later sentinel after an incomplete
earlier sentinel. Starting at the first incomplete sentinel, apply each exact
file through `0017` with:

```zsh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration_file"
```

After every file, re-query its sentinel and stop immediately if incomplete.

Never print the database URL.

- [ ] **Step 5: Rewrite the runbook for the public sandbox**

Document:

- the public/no-login/non-confidential warning;
- how to store `vsee-supabase-db-url` securely;
- migration command;
- foreground Worker command and log location;
- health requirements before Scan;
- upload → extraction → confirmation → XTrace → scan → report flow;
- named framework report sections;
- Reset semantics;
- rollback to the prior Sites version and `public_demo`;
- the fact that forward migrations stay applied during rollback.

- [ ] **Step 6: Run tests and commit**

Run:

```bash
node --import tsx --test --test-concurrency=1 \
  tests/unit/worker-deployment.test.ts \
  tests/unit/release-readiness.test.ts
```

Expected: PASS.

Commit:

```bash
git add docs/demo-runbook.md scripts/run-worker-from-keychain.zsh \
  scripts/apply-production-migrations.zsh .gitignore \
  tests/unit/worker-deployment.test.ts tests/unit/release-readiness.test.ts
git commit -m "docs: add public sandbox production operations"
```

---

### Task 8: Verify locally, migrate production, and deploy the exact commit

**Files:**
- Modify only if verification exposes a defect in an earlier task.
- Record evidence in: `docs/release-evidence/2026-07-30-public-sandbox.md`

**Interfaces:**
- Consumes: all earlier tasks and the reviewed source commit.
- Produces: one saved Sites version and production deployment at the existing VSee URL.
- Produces: one end-to-end report acceptance record without secret values.

- [ ] **Step 1: Run the full local verification gate**

Run:

```bash
npm test
npm run test:migrations
npm run typecheck
npm run lint
npm run build
git diff --check
git status --short
```

Expected:

- all tests PASS, with only the explicitly external live-XTrace test allowed to skip when its opt-in flag is absent;
- all PostgreSQL migration tests PASS through `0017`;
- typecheck, lint, and build PASS;
- no unexpected working-tree changes.

- [ ] **Step 2: Inspect the production Web bundle**

Run:

```bash
rg -n "mammoth|unpdf" .vinext dist .next 2>/dev/null
```

Expected: no parser package in the Web/Cloudflare bundle. Parser references may exist only in Worker-oriented build artifacts.

- [ ] **Step 3: Apply production migrations sequentially**

Before execution, confirm the direct database URL is present in Keychain without printing it:

```bash
security find-generic-password -a "$USER" -s "vsee-supabase-db-url" >/dev/null
```

Run:

```bash
./scripts/apply-production-migrations.zsh
```

Expected: first missing migration through `0017` applies without gaps. Verify required tables/RPCs through fixed metadata queries, not by dumping credentials.

- [ ] **Step 4: Start the Worker from the exact candidate commit**

Record:

```bash
git rev-parse HEAD
./scripts/run-worker-from-keychain.zsh
```

In a second shell, run:

```bash
npm run worker:health
```

Expected: a fresh heartbeat is visible and the production health endpoint reports PostgreSQL, Worker, Anthropic, Storage, Corpus, and the selected XTrace mode ready.

- [ ] **Step 5: Run the end-to-end acceptance flow before deployment**

Against a local Web process using production integrations:

1. upload one TXT, one PDF with second-page evidence, one DOCX, one PNG, and one WebP;
2. prove JPG, JPEG, GIF, audio, legacy DOC, malformed PDF, and malformed DOCX are rejected;
3. confirm company name, Deal assignment, status, and ownership;
4. wait for XTrace ingest readiness;
5. run one structured scan and one XTrace scan;
6. inspect medium/high-confidence market events;
7. open the complete Top-5 report;
8. inspect at least two named advisory viewpoints and one disagreement or explicit “Unavailable” state;
9. inspect exact market, Source Revision, PDF-page, framework-source, calculation, and decision lineage;
10. edit and save one action draft, then copy/download it;
11. Reset the current test view and prove old default rows disappear while a direct immutable report link still opens;
12. run a fresh scan and prove the new generation appears.

- [ ] **Step 6: Save release evidence**

Create `docs/release-evidence/2026-07-30-public-sandbox.md` with:

- source commit SHA;
- migration range and verification result;
- Worker heartbeat time;
- Sites version ID;
- production deployment URL;
- structured and XTrace run IDs;
- report ID and inspected Deal IDs;
- named advisory packs observed;
- accepted/rejected upload matrix;
- Reset marker time;
- test/typecheck/lint/build counts;
- known limitations: no login, public test data only, no scanned-PDF OCR, no audio, no external message delivery.

Do not include keys, connection strings, authorization headers, signed source URLs, or private source contents.

- [ ] **Step 7: Push, save, and deploy the exact source state**

1. commit the release-evidence file;
2. push the exact commit;
3. set Sites runtime environment to `VSEE_DEPLOYMENT_MODE=public_sandbox`;
4. retain public access mode;
5. push the exact source state required by Sites;
6. save a new Sites version using that exact commit SHA;
7. deploy only the saved version to the existing production URL;
8. inspect deployment status until terminal.

Expected: the deployed commit equals the locally verified and pushed commit.

- [ ] **Step 8: Re-run production smoke tests**

Verify:

- warning banner;
- Reset dialog;
- upload allowlist;
- health and Worker;
- Fund Policy read/write;
- Scan creation/progress;
- complete report and named advisory views;
- Chat/Search over durable existing data;
- signed source links;
- action-draft edit/save/copy/download;
- Reset and fresh-generation behavior.

If any acceptance fails, restore the previous saved Sites version and
`VSEE_DEPLOYMENT_MODE=public_demo`, stop the Worker, record the failure, and
retain forward database migrations.
