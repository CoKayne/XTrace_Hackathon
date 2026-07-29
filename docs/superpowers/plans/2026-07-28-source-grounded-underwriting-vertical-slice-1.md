# Source-Grounded VC Underwriting Vertical Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不破壞既有市場掃描、19 筆 demo corpus、Report URL、CompanyAnalysis 與 Chat 的前提下，交付第一條可稽核的 VC 承保決策鏈：確認來源 → 統一 Deal Registry → Evidence Pack → Fund Policy／Router → 多框架判斷 → 確定性估值與決策 → 報告、查詢與只產生草稿的下一步行動。

**Architecture:** PostgreSQL 保存 immutable source revision、版本化規則、承保 artifact 與逐 claim lineage；XTrace 只負責跨時間召回歷史投資脈絡，召回內容必須還原至本機來源後才能成為 Fact；Claude 只負責抽取、框架判斷、分歧與敘事，所有財務計算與正式 `Pass／Watch／Advance／Invest Candidate` 均由版本化的 deterministic code 產生。Worker 保留既有 14-day scan 與全部 eligible Deal 的 CompanyAnalysis，再只對 Top 5 中／高信心 `belief_revised` 候選執行完整 Underwriting；其餘 Deal 保存 `not_selected`，不得被解讀為 `Pass`。

**Tech Stack:** TypeScript 5.9、Next.js 16／React 19、vinext／Cloudflare、Zod 4、Drizzle ORM、PostgreSQL／Supabase REST、XTrace Memory API、Anthropic Claude、decimal.js 10.6.0、Node test runner。

## Global Constraints

- **Side Quest coordination override (2026-07-28):** 主線不得研究、蒸餾、撰寫或 seed 任何真實具名 VC／投資人框架內容。獨立 Side Quest 負責該內容，完成後以 branch／commit 交接。Task 7／11 在交接前只能實作 framework schema、registry、匯入驗證、執行／分歧／報告基礎設施，以及明確標示為 synthetic 的測試 fixtures；本計畫後文列出的真實框架名稱與公開來源暫停執行，直到使用者明確提供 Side Quest 成果。
- 第一版分析只由使用者按下 `Run Analysis` 手動啟動；資料契約可容納 `scheduled`，但不得建立另一套排程分析邏輯。
- 市場掃描固定使用最近 14 天的全球公開資料。
- 所有 `analysis_eligible` Deal 都必須得到既有 `CompanyAnalysis`；目前 seed 恰為 19 筆，但任何 production invariant、API validation、資料庫 constraint 或 UI copy 都不得把 cardinality 寫死為 19。
- 只有 Top 5 中／高信心 `belief_revised` 候選進入完整 Underwriting；未入選保存 `underwriting_status = not_selected`，不是 `Pass`。
- Runtime upload 只接受 TXT、Markdown、JPEG、PNG、GIF、WebP；固定 PDF corpus 只作為 preloaded source。Audio、一般 PDF、DOCX、Gmail 與 Google Drive ingestion 不在本切片。
- Upload 必須先完成 extraction preview，再由使用者確認公司名稱與既有／新 Deal 歸屬；確認前不得建立 authoritative Deal、不得標示 `analysis_eligible`、不得 ingest XTrace。
- 原始 upload 永久保存於 workspace-private object storage；private source 只能經過 workspace authorization 取得短效 signed access。
- 五種分析型別固定為 `fact／assumption／calculation／framework_judgment／final_synthesis`；來源維度另存，不得互相冒充。
- XTrace 是 recall transport，不是 citation authority；未解析回 immutable local lineage 的 recall text 不得支持 Fact。
- Evidence Pack 是 lens 與 valuation 唯一可使用的公司分析輸入。
- Money、Rate、Multiple 與 authoritative financial output 不得使用 JavaScript binary float；輸入輸出使用 decimal string／PostgreSQL `numeric`，只在顯示邊界 rounding。
- Vertical Slice 1 只支援 Seed／Series A × B2B SaaS／Enterprise AI 的 A-depth context，以及 market comps、VC Method、simple ownership／dilution、gross deal-level MOIC／IRR；DCF、SAFE／note conversion、option pool、preferred waterfall、net fund returns 與其他 sector specialist 不在本切片。
- 公司品質、價格吸引力與基金適配必須分別保存；LLM 不得產生或覆寫正式 decision、ceiling、veto、formula output。
- `Invest Candidate` 只有在無 hard veto、critical evidence complete、Company Quality 通過、Price Attractiveness 通過、Fund Fit 通過時成立；它只表示值得進入最終投資審查。
- 最低估值輸入不足時 `underwriting_status = unavailable` 且 `decision = null`；仍可分析但有 critical blocker 時最高為 `Advance`。
- 八個 Universal Core lenses 與 B2B SaaS／Enterprise AI specialist 必須獨立執行；分歧要保存，不得以平均分數消除。
- 每個 run 固定 Fund Policy、candidate context、Critical Evidence、Benchmark、Valuation Method、Decision、Framework、Formula、模型／prompt／schema／settings 與 application commit 版本。
- Scan、batch、candidate 都必須冪等；`force_refresh` 建立帶 `refresh_nonce` 且連回 `rerun_of_id` 的新 immutable result。
- Candidate finalization 必須原子保存 calculations、judgments、disagreements、valuation、decision、claim edges 與版本 snapshot；單一 candidate 失敗只使 batch `partial`。
- 舊 Report URL、既有 `CompanyAnalysis.outcome`、legacy opportunities、Deals、Chat 與 browser-local `InternalReportDraft` 必須向後相容。
- 新 `ActionDraft` 只保存 channel、`audience_type` 與 editable body；不得保存地址／handle／delivery state，不得建立 send／publish integration。
- Chat／Search 只讀取已持久化資料；不得瀏覽網路、啟動分析、修改 Policy、重算或建立／發送草稿。
- `public_demo` 只能讀固定非敏感 corpus；upload、source／Policy／Framework mutation 與 private-source access 全部 `403`。`product` 必須有 authenticated principal，workspace 只由 server-side membership 解析。
- 所有 public serializer 移除 object key、lease、provider diagnostics、內部 prompt、service role 資訊與未清理錯誤。
- `Fetter Family Cafe.m4a` 是研究素材，不是產品輸入或 seed；不得 stage、搬移或提交。
- 所有程式修改遵守 TDD：先看見測試因缺少行為而正確失敗，再寫最小實作；每個任務獨立 commit 並經 spec／quality review。

---

## Execution Preflight

目前 `main` 上有未提交的 upload prototype。執行前先建立 recoverable checkpoint branch，僅提交下列 prototype 檔案，不提交音檔：

```bash
git switch -c checkpoint/upload-prototype-20260728
git add app/page.tsx app/vsee.css lib/claude/client.ts lib/storage/service.ts \
  package.json package-lock.json worker/runner.ts \
  app/api/documents/upload app/api/documents/uploaded \
  db/repositories/uploaded-documents.ts drizzle/0007_uploaded_documents.sql \
  lib/uploads tests/unit/upload-extraction.test.ts worker/extract-upload.ts
git commit -m "chore: checkpoint upload extraction prototype"
```

再依 `superpowers:using-git-worktrees` 建立
`feat/source-grounded-underwriting-v1` isolated worktree，起點為上述 checkpoint。
`.worktrees/` 若不存在，先加入 `.gitignore` 並建立獨立 commit。任何 execution
commit 都只能發生在 feature worktree。

Baseline 記錄如下，後續不得把這兩筆環境失敗誤判為新 regression：

```text
npm run typecheck: PASS
npm run lint: PASS
npm test: 237 tests; 229 pass, 2 fail, 6 skip
2 failures: chat route tests cannot listen on 127.0.0.1 in the sandbox (EPERM)
```

## File Structure

### New focused boundaries

- `lib/auth/*`：deployment mode、session、membership 與 shared request context。
- `lib/contracts/evidence.ts`：immutable source、typed evidence、locator、claim edge。
- `lib/contracts/underwriting.ts`：policy、context、batch、candidate、valuation、decision 與 draft schemas。
- `lib/uploads/*`：runtime format validation、staging DTO、confirmation service。
- `db/repositories/source-registry.ts`、`deal-registry.ts`：seed 與 confirmed upload 的唯一 authoritative source／Deal query。
- `lib/underwriting/references/*`：Fund Policy、Benchmark、Framework、Router、Critical Evidence、Valuation Method、Decision registries。
- `lib/underwriting/evidence/*`：Evidence Pack 建立、normalization、conflict、coverage。
- `lib/underwriting/frameworks/*`：獨立 lens、grounding validator、cache、disagreement。
- `lib/underwriting/valuation/*`：decimal primitive、market comps、VC Method、ownership、dilution、MOIC／IRR。
- `lib/underwriting/decision/*`：deterministic rule evaluation 與 fired-rule trace。
- `lib/underwriting/orchestrator.ts`：candidate stage coordination，不包含公式或 UI mapping。
- `lib/underwriting/read-model.ts`：Report／Chat／Search 共用的 finalized artifact projection。
- `app/fund-policy.tsx`、`source-upload-flow.tsx`、`underwriting-summary.tsx`、`underwriting-detail.tsx`、`action-draft-dialog.tsx`：避免繼續擴大 `app/page.tsx`。

### Migration order

- `0007_uploaded_documents.sql`：只負責 upload staging、lease 與 preview。
- `0009_source_revision_deal_registry.sql`：immutable source revision、assignment、eligible Deal。
- `0010_underwriting_references.sql`：Policy／Benchmark／Framework／Router／Decision version registry。
- `0011_underwriting_runs.sql`：batch、selection、candidate、checkpoint、artifact 與 atomic finalization。

---

### Task 1: Convert the dirty upload prototype into preview-only staging

**Files:**
- Modify: `drizzle/0007_uploaded_documents.sql`
- Modify: `db/repositories/uploaded-documents.ts`
- Modify: `lib/uploads/service.ts`
- Modify: `lib/storage/service.ts`
- Modify: `lib/claude/client.ts`
- Modify: `worker/extract-upload.ts`
- Modify: `worker/runner.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tests/unit/upload-extraction.test.ts`
- Create: `tests/unit/upload-staging-lifecycle.test.ts`

**Interfaces:**
- Consumes: existing private object storage and `ClaudeClient.complete`.
- Produces:

```ts
export type UploadedDocumentStatus =
  | "queued"
  | "extracting"
  | "awaiting_confirmation"
  | "confirmed"
  | "ingesting_memory"
  | "ready"
  | "failed";

export interface ExtractionPreview {
  candidateCompanyName: string | null;
  candidateHeadline: string | null;
  facts: Array<{
    text: string;
    excerpt: string | null;
    locator:
      | { kind: "text_range"; start: number; end: number }
      | { kind: "image"; imageIndex: 0 };
  }>;
  extractionMetadata: {
    extractorId: "plain_text_v1" | "claude_vision_v1";
    extractorVersion: "1";
    extractedAt: string;
    contentHash: string;
    inputBytes: number;
    extractedCharacters: number;
    truncated: false;
  };
}
```

```ts
export const RUNTIME_UPLOAD_CONTENT_TYPES = [
  "text/plain",
  "text/markdown",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;
```

- [ ] **Step 1: Write failing format and lifecycle tests**

Add table-driven cases which hand-derive the accepted MIME result:

```ts
for (const [filename, expected] of [
  ["notes.txt", "text/plain"],
  ["notes.md", "text/markdown"],
  ["slide.jpg", "image/jpeg"],
  ["slide.png", "image/png"],
  ["slide.gif", "image/gif"],
  ["slide.webp", "image/webp"],
] as const) {
  test(`accepts ${filename}`, () => {
    assert.equal(resolveRuntimeUploadContentType({ filename }), expected);
  });
}

for (const filename of ["deck.pdf", "memo.docx", "call.m4a"]) {
  test(`rejects ${filename}`, () => {
    assert.throws(() => resolveRuntimeUploadContentType({ filename }));
  });
}

test("extraction stops at confirmation preview without Deal or XTrace side effects", async () => {
  const effects: string[] = [];
  const result = await processClaimedUpload(uploadFixture(), {
    extract: async () => previewFixture(),
    savePreview: async () => effects.push("preview"),
    createDeal: async () => effects.push("deal"),
    ingestXTrace: async () => effects.push("xtrace"),
  });
  assert.equal(result.status, "awaiting_confirmation");
  assert.deepEqual(effects, ["preview"]);
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
node --import tsx --test tests/unit/upload-extraction.test.ts tests/unit/upload-staging-lifecycle.test.ts
```

Expected: FAIL because `resolveRuntimeUploadContentType`, the image content block, and preview-only lifecycle do not exist; the old PDF/DOCX behavior must also fail the new assertions.

- [ ] **Step 3: Implement the approved format and preview state machine**

Use workspace/upload-scoped keys:

```ts
export function uploadedObjectKey(input: {
  workspaceId: string;
  uploadId: string;
  filename: string;
}): string {
  return `private/workspaces/${input.workspaceId}/uploads/${input.uploadId}/${safeFilename(input.filename)}`;
}
```

`worker/extract-upload.ts` must decode TXT/Markdown deterministically and send image bytes as an Anthropic image content block. It must not create `DealMemoryBundle`, call XTrace, or silently slice the content. Persist the complete preview and transition to `awaiting_confirmation`.

Remove `mammoth` and `unpdf`; keep fixed PDF seed parsing outside runtime upload. Change `ClaudeContentBlock` to:

```ts
export type ClaudeContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: {
        type: "base64";
        media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
        data: string;
      };
    };
```

- [ ] **Step 4: Verify GREEN and regressions**

Run:

```bash
node --import tsx --test tests/unit/upload-extraction.test.ts tests/unit/upload-staging-lifecycle.test.ts tests/unit/claude-client.test.ts
npm run typecheck
npm run lint
```

Expected: all listed tests PASS; TypeScript and lint PASS.

- [ ] **Step 5: Commit**

```bash
git add drizzle/0007_uploaded_documents.sql db/repositories/uploaded-documents.ts \
  lib/uploads/service.ts lib/storage/service.ts lib/claude/client.ts \
  worker/extract-upload.ts worker/runner.ts package.json package-lock.json \
  tests/unit/upload-extraction.test.ts tests/unit/upload-staging-lifecycle.test.ts
git commit -m "feat(upload): stage approved sources for confirmation"
```

---

### Task 2: Add deployment mode, authenticated principal, and membership context

**Files:**
- Create: `lib/auth/session.ts`
- Create: `lib/auth/request-context.ts`
- Create: `db/repositories/workspace-memberships.ts`
- Modify: `lib/api/response.ts`
- Modify: `.env.example`
- Create: `tests/unit/request-context.test.ts`
- Create: `tests/unit/workspace-memberships.test.ts`

**Interfaces:**
- Produces:

```ts
export type DeploymentMode = "public_demo" | "product";
export type WorkspaceRole = "owner" | "partner" | "associate" | "admin" | "demo";

export interface AuthenticatedPrincipal {
  userId: string;
  email: string;
}

export interface AuthorizedRequestContext {
  mode: DeploymentMode;
  principal: AuthenticatedPrincipal | null;
  workspaceId: string;
  role: WorkspaceRole;
  permissions: {
    readWorkspace: true;
    readPrivateSources: boolean;
    mutateSources: boolean;
    managePolicy: boolean;
    administerFrameworks: boolean;
  };
}

export async function resolveRequestContext(
  request: Request,
  dependencies?: {
    environment?: Record<string, string | undefined>;
    resolveSession?: (request: Request) => Promise<AuthenticatedPrincipal | null>;
    memberships?: WorkspaceMembershipsRepository;
  },
): Promise<AuthorizedRequestContext>;
```

```ts
export interface WorkspaceMembershipsRepository {
  resolvePrimaryMembership(userId: string): Promise<{
    workspaceId: string;
    role: Exclude<WorkspaceRole, "demo">;
  } | null>;
}
```

- [ ] **Step 1: Write failing authorization-context tests**

```ts
test("public demo resolves the server demo workspace with mutation disabled", async () => {
  const context = await resolveRequestContext(new Request("https://vsee.test/api/deals"), {
    environment: {
      VSEE_DEPLOYMENT_MODE: "public_demo",
      DEMO_WORKSPACE_ID: "workspace_demo",
    },
  });
  assert.equal(context.workspaceId, "workspace_demo");
  assert.equal(context.role, "demo");
  assert.equal(context.permissions.mutateSources, false);
});

test("product mode ignores a forged workspace and resolves membership", async () => {
  const request = new Request("https://vsee.test/api/deals?workspaceId=attacker", {
    headers: { "x-test-user": "user_1" },
  });
  const context = await resolveRequestContext(request, productContextFixture({
    membership: { workspaceId: "workspace_real", role: "partner" },
  }));
  assert.equal(context.workspaceId, "workspace_real");
});

test("product mode rejects an authenticated non-member", async () => {
  await assert.rejects(
    resolveRequestContext(new Request("https://vsee.test/api/deals"), productContextFixture({
      membership: null,
    })),
    /FORBIDDEN/,
  );
});
```

- [ ] **Step 2: Run and verify RED**

Run:

```bash
node --import tsx --test tests/unit/request-context.test.ts tests/unit/workspace-memberships.test.ts
```

Expected: FAIL because the auth modules and membership repository do not exist.

- [ ] **Step 3: Implement fail-closed context and sanitized API errors**

Set `.env.example`:

```text
VSEE_DEPLOYMENT_MODE=public_demo
DEMO_WORKSPACE_ID=workspace_demo
```

Add `UNAUTHENTICATED` → 401 and `FORBIDDEN` → 403 to `lib/api/response.ts`. Only known public messages may reach the response; unexpected `Error.message` is logged server-side and returned as `INTERNAL_ERROR`.

`product` may resolve a principal only through the trusted session adapter, then resolve one server-side membership. No body, query, cookie or caller-supplied header may directly select `workspaceId`.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
node --import tsx --test tests/unit/request-context.test.ts tests/unit/workspace-memberships.test.ts tests/unit/api-safety.test.ts
npm run typecheck
npm run lint
```

Expected: all listed checks PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/auth lib/api/response.ts db/repositories/workspace-memberships.ts \
  .env.example tests/unit/request-context.test.ts tests/unit/workspace-memberships.test.ts
git commit -m "feat(security): resolve deployment and workspace context"
```

---

### Task 3: Put every existing workspace API behind the shared boundary

**Files:**
- Modify: all `app/api/**/route.ts`
- Modify: `lib/api/safety.ts`
- Modify: `db/repositories/intelligence.ts`
- Modify: `db/repositories/runs.ts`
- Modify: `lib/storage/service.ts`
- Create: `tests/integration/api-authorization.test.ts`
- Modify: existing route integration tests under `tests/integration/`

**Interfaces:**
- Consumes: `resolveRequestContext(request)` from Task 2.
- Produces:

```ts
export function requirePermission(
  context: AuthorizedRequestContext,
  permission: keyof AuthorizedRequestContext["permissions"],
): void;
```

Repository lookups become workspace-scoped:

```ts
getReport(workspaceId: string, reportId: string): Promise<IntelligenceReportRecord | null>;
getReportByRunId(workspaceId: string, runId: string): Promise<IntelligenceReportRecord | null>;
getRun(workspaceId: string, runId: string): Promise<RunRecord | null>;
```

- [ ] **Step 1: Add a table-driven failing route matrix**

`tests/integration/api-authorization.test.ts` invokes every current route and asserts:

```ts
const productReadRoutes = [
  "/api/overview",
  "/api/deals",
  "/api/documents",
  "/api/market/events",
  "/api/reports",
  "/api/runs",
  "/api/settings/health",
];

for (const path of productReadRoutes) {
  test(`${path} rejects product requests without a session`, async () => {
    const response = await invokeRoute(path, { mode: "product", session: null });
    assert.equal(response.status, 401);
  });
}

for (const path of [
  "/api/documents/upload",
  "/api/imports/confirm",
  "/api/demo/reset",
]) {
  test(`${path} rejects public-demo mutation`, async () => {
    const response = await invokeRoute(path, { mode: "public_demo" });
    assert.equal(response.status, 403);
  });
}
```

Add negative tests proving report ID, run ID, Deal analysis, uploaded-source access and reset cannot cross workspaces.

- [ ] **Step 2: Run the authorization suite and verify RED**

Run:

```bash
node --import tsx --test tests/integration/api-authorization.test.ts
```

Expected: FAIL because routes still hardcode `workspace_demo`, ID reads are unscoped, and public upload/reset remain callable.

- [ ] **Step 3: Retrofit routes and private capabilities**

Every route must begin by resolving context and must pass only
`context.workspaceId` to repositories. Remove request JSON `workspaceId` from mutation contracts.

Replace the private source capability payload with:

```ts
export interface PrivateSourceCapability {
  workspaceId: string;
  sourceRevisionId: string;
  objectVersion: string;
  expiresAtEpochSeconds: number;
  permission: "read";
}
```

Issue links only after authorization; validate the same payload on read. Public demo cannot receive private capabilities. Product mutation rate limits include principal + workspace, not only IP.

- [ ] **Step 4: Verify GREEN and legacy route behavior**

Run:

```bash
node --import tsx --test tests/integration/api-authorization.test.ts \
  tests/integration/deals-route.test.ts tests/integration/reports-route.test.ts \
  tests/integration/company-analyses-route.test.ts tests/unit/runs-route.test.ts \
  tests/unit/storage-service.test.ts
npm run typecheck
npm run lint
```

Expected: authorization matrix and existing happy-path contracts PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api lib/api/safety.ts db/repositories/intelligence.ts \
  db/repositories/runs.ts lib/storage/service.ts tests/integration tests/unit/runs-route.test.ts \
  tests/unit/storage-service.test.ts
git commit -m "feat(security): authorize all workspace API routes"
```

---

### Task 4: Define immutable evidence, underwriting, and exact decimal contracts

**Files:**
- Create: `lib/contracts/evidence.ts`
- Create: `lib/contracts/underwriting.ts`
- Create: `lib/underwriting/numbers.ts`
- Modify: `lib/contracts/http.ts`
- Test: `tests/contracts/evidence.test.ts`
- Test: `tests/contracts/underwriting.test.ts`
- Test: `tests/unit/underwriting-numbers.test.ts`
- Modify: `tests/contracts/domain.test.ts`

**Interfaces:**
- Legacy `SourceRef` remains unchanged.
- Produces:

```ts
export const AnalysisTypeSchema = z.enum([
  "fact",
  "assumption",
  "calculation",
  "framework_judgment",
  "final_synthesis",
]);

export const ProvenanceOriginSchema = z.enum([
  "management",
  "uploaded_document",
  "public_source",
  "benchmark",
  "recommended_policy",
  "user_custom",
]);

export const EvidenceLocatorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text_range"), start: z.number().int().nonnegative(), end: z.number().int().positive(), excerpt: z.string().min(1) }),
  z.object({ kind: z.literal("pdf_page"), page: z.number().int().positive(), excerpt: z.string().min(1) }),
  z.object({ kind: z.literal("image"), imageIndex: z.number().int().nonnegative(), region: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable() }),
  z.object({ kind: z.literal("web_snapshot"), url: z.string().url(), excerpt: z.string().min(1) }),
]);
```

```ts
export type DecimalString = string & { readonly __decimalString: unique symbol };
export interface MoneyValue {
  amount: DecimalString;
  currency: "USD";
  scale: number;
  asOfDate: string;
}
export interface RateValue {
  value: DecimalString;
  basis: "decimal";
}
```

```ts
export const ConfirmUploadSchema = z.object({
  companyName: z.string().trim().min(1).max(160),
  assignment: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("existing_deal"), dealId: z.string().min(1) }),
    z.object({ kind: z.literal("new_deal"), dealStatus: DealStatusSchema }),
  ]),
});
```

The new schemas use these exact persisted shapes:

```ts
export interface SourceRevision {
  id: string;
  workspaceId: string;
  sourceId: string;
  revision: number;
  contentHash: string;
  objectKey: string;
  objectVersion: string;
  contentType: string;
  extractorId: string;
  extractorVersion: string;
  extractedAt: string;
  supersedesRevisionId: string | null;
  createdAt: string;
}

export interface Fact {
  id: string;
  analysisType: "fact";
  provenanceOrigin:
    | "management"
    | "uploaded_document"
    | "public_source";
  field: string;
  value: string;
  unit: string | null;
  currency: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  publishedAt: string | null;
  eventAt: string | null;
  retrievedAt: string;
  sourceRevisionId: string;
  locator: EvidenceLocator;
  sourceRole: "management" | "first_party_filing" | "independent_third_party";
  assertionStatus: "reported" | "corroborated" | "verified" | "disputed";
  verificationMethod: string | null;
  freshness: "current" | "stale" | "unknown";
  acceptedForGate: boolean;
}

export interface Assumption {
  id: string;
  analysisType: "assumption";
  provenanceOrigin: "benchmark" | "recommended_policy" | "user_custom";
  scenario: "bear" | "base" | "bull" | "all";
  field: string;
  value: string;
  unit: string | null;
  rationale: string;
  inputRefIds: string[];
  sensitivity: "low" | "medium" | "high";
  requiresConfirmation: boolean;
}

export interface Calculation {
  id: string;
  analysisType: "calculation";
  formulaId: string;
  formulaVersion: string;
  inputRefs: Array<{ itemId: string; value: string; type: "fact" | "assumption" | "policy" | "benchmark" }>;
  output: string;
  unit: string;
  currency: string | null;
  period: string | null;
  roundingPolicy: "half_even_display_only";
  computedAt: string;
  status: "completed" | "not_applicable" | "insufficient_input" | "unsupported_terms" | "invalid_domain" | "stale_benchmark";
}

export interface ClaimEdge {
  claimItemId: string;
  dependencyItemId: string;
  dependencyType:
    | "fact"
    | "assumption"
    | "calculation"
    | "framework_judgment"
    | "policy_ref"
    | "benchmark_ref"
    | "framework_ref";
}

export interface EvidencePack {
  id: string;
  version: number;
  workspaceId: string;
  dealId: string;
  asOfDate: string;
  sourceRevisionIds: string[];
  facts: Fact[];
  assumptions: Assumption[];
  conflicts: EvidenceConflict[];
  coverage: EvidenceCoverageResult;
  createdAt: string;
}

export interface EvidenceConflict {
  id: string;
  field: string;
  leftFactId: string;
  rightFactId: string;
  materialityRuleId: string;
  material: boolean;
  status: "open" | "resolved" | "immaterial";
  resolutionFactId: string | null;
  resolutionReason: string | null;
}

export interface EvidenceCoverageResult {
  minimumModelInputsComplete: boolean;
  criticalEvidenceComplete: boolean;
  missingFieldIds: string[];
  blockingConflictIds: string[];
  decisionCeiling: "Pass" | "Watch" | "Advance" | "Invest Candidate" | null;
  underwritingStatus: "available" | "unavailable";
  reasonCodes: string[];
}

export interface FundPolicySnapshot {
  id: string;
  workspaceId: string;
  version: number;
  source: "recommended_policy" | "user_custom";
  values: Record<string, string | string[] | boolean | null | Record<string, unknown>>;
  createdByUserId: string | null;
  createdAt: string;
}

export interface ResolvedUnderwritingContext {
  id: string;
  contextVersion: string;
  stage: "seed" | "series_a";
  businessModel: "b2b_saas" | "enterprise_ai";
  geography: "us" | "global";
  securityType: "preferred";
  asOfDate: string;
  criticalEvidenceProfileId: string;
  benchmarkPackId: string | null;
  benchmarkCompatibility: "exact" | "broad_compatible" | "adjacent_only" | "unavailable";
  valuationMethodPolicyId: string;
  decisionPolicyId: string;
  frameworkPackId: string;
}

export interface FrameworkJudgment {
  id: string;
  analysisType: "framework_judgment";
  frameworkCardId: string;
  frameworkVersion: string;
  applicability: "applicable" | "not_applicable" | "unavailable";
  conclusion: "supportive" | "mixed" | "negative" | "abstain";
  supportEvidenceItemIds: string[];
  counterEvidenceItemIds: string[];
  unusedEvidenceItemIds: string[];
  strongestSupport: string | null;
  strongestCounterargument: string | null;
  unknowns: string[];
  limitations: string[];
  confidence: {
    sourceReliability: "low" | "medium" | "high";
    evidenceStrength: "low" | "medium" | "high";
    evidenceCoverage: "low" | "medium" | "high";
    applicability: "low" | "medium" | "high";
    judgment: "low" | "medium" | "high";
  };
  claimEdges: ClaimEdge[];
  fingerprint: string;
}

export interface FrameworkDisagreement {
  id: string;
  leftJudgmentId: string;
  rightJudgmentId: string;
  topic:
    | "growth_vs_revenue_quality"
    | "fde_moat_vs_services_burden"
    | "tam_vs_willingness_to_pay"
    | "company_quality_vs_price"
    | "contrarian_insight_vs_adoption";
  explanation: string;
  evidenceItemIds: string[];
}

export interface ValuationEvaluation {
  id: string;
  status: "completed" | "partial" | "unavailable";
  scenarios: Array<{
    name: "bear" | "base" | "bull";
    valuation: string | null;
    calculationIds: string[];
  }>;
  currentAsk: string | null;
  maximumAcceptablePreMoney: string | null;
  initialOwnership: string | null;
  postDilutionOwnership: string | null;
  grossMoic: string | null;
  grossIrr: string | null;
  pricingPremium: string | null;
  calculationIds: string[];
  blockerCodes: string[];
}

export interface ScenarioInput {
  id: string;
  scenario: "bear" | "base" | "bull";
  field:
    | "revenue_path"
    | "arr_path"
    | "growth"
    | "gross_margin"
    | "contribution_margin"
    | "operating_expenses"
    | "burn"
    | "cash"
    | "runway"
    | "future_financing"
    | "future_dilution"
    | "exit_timing"
    | "exit_method"
    | "exit_multiple"
    | "success_conditions"
    | "failure_conditions"
    | "probability";
  value: string | null;
  unit: string | null;
  evidenceItemId: string | null;
  assumptionItemId: string | null;
  unavailableReason: string | null;
}

export interface ScenarioModel {
  id: string;
  candidateRunId: string;
  formulaPolicyVersion: string;
  scenarios: Array<{
    name: "bear" | "base" | "bull";
    inputs: ScenarioInput[];
  }>;
  probabilityWeighted: boolean;
}

export interface DecisionResult {
  id: string;
  analysisType: "final_synthesis";
  companyQuality: "pass" | "mixed" | "fail" | "unavailable";
  priceAttractiveness: "pass" | "mixed" | "fail" | "unavailable";
  fundFit: "pass" | "mixed" | "fail" | "unavailable";
  decision: "Pass" | "Watch" | "Advance" | "Invest Candidate" | null;
  decisionCeiling: "Pass" | "Watch" | "Advance" | "Invest Candidate" | null;
  hardVeto: boolean;
  firedRules: Array<{
    ruleId: string;
    inputRefs: string[];
    result: "pass" | "fail" | "not_applicable";
    appliedCeiling: string | null;
    veto: boolean;
  }>;
  blockingEvidenceItemIds: string[];
  claimEdges: ClaimEdge[];
  confidence: "low" | "medium" | "high";
}

export interface UnderwritingBatch {
  id: string;
  workspaceId: string;
  scanRunId: string;
  status: "queued" | "running" | "partial" | "completed" | "failed";
  batchInputFingerprint: string;
  fundPolicySnapshotId: string;
  rerunOfId: string | null;
  createdAt: string;
}

export interface UnderwritingSelection {
  batchId: string;
  dealId: string;
  status: "selected" | "not_selected";
  rank: number | null;
  reason: string;
}

export interface CandidateRun {
  id: string;
  batchId: string;
  workspaceId: string;
  dealId: string;
  status: "queued" | "running" | "partial" | "completed" | "unavailable" | "failed";
  candidateAnalysisFingerprint: string;
  rerunOfId: string | null;
  createdAt: string;
  finalizedAt: string | null;
}

export interface CandidateCheckpoint {
  candidateRunId: string;
  stage:
    | "evidence_pack"
    | "context_router"
    | "valuation"
    | "framework_lenses"
    | "decision"
    | "narrative_drafts"
    | "finalization";
  status: "running" | "completed" | "failed";
  artifactFingerprint: string;
  publicReason: string | null;
  savedAt: string;
}

export interface XTraceLineageSnapshot {
  memoryIds: string[];
  sourceRevisionIds: string[];
  sourceIds: string[];
  fixtureIds: string[];
  capturedAt: string;
}

export interface MissingEvidenceItem {
  fieldId: string;
  label: string;
  reasonCode: string;
  mostLikelyDecisionImpact: string;
}

export interface ActionDraft {
  id: string;
  workspaceId: string;
  candidateRunId: string;
  channel: "email" | "sms" | "linkedin" | "internal_memo" | "dd_request";
  audienceType: "founder" | "customer" | "internal";
  body: string;
  createdAt: string;
  updatedAt: string;
}
```

`FrameworkJudgment` includes card/version, applicability, used/unused/support/
counter evidence IDs, criterion claim edges, strongest support/counterargument,
unknowns, limitations, five separate confidence dimensions, and conflicts.
`FinalSynthesis` includes Company Quality, Price Attractiveness, Fund Fit,
decision/ceiling/veto, fired rules, blocking evidence and claim edges; its
schema rejects a direct source revision dependency that bypasses a saved
Fact/Calculation/Judgment.

- [ ] **Step 1: Write failing schema and exact-number tests**

```ts
test("rejects a Fact without immutable source revision lineage", () => {
  assert.throws(() => FactSchema.parse({
    ...factFixture(),
    sourceRevisionId: null,
  }));
});

test("keeps exact decimal arithmetic out of JavaScript Number", () => {
  assert.equal(addDecimalStrings("0.1", "0.2"), "0.3");
  assert.equal(multiplyDecimalStrings("1250000", "0.125"), "156250");
});

test("rejects a client-supplied workspace in upload confirmation", () => {
  assert.throws(() => ConfirmUploadSchema.strict().parse({
    ...confirmUploadFixture(),
    workspaceId: "forged",
  }));
});
```

- [ ] **Step 2: Run and verify RED**

Run:

```bash
node --import tsx --test tests/contracts/evidence.test.ts \
  tests/contracts/underwriting.test.ts tests/unit/underwriting-numbers.test.ts
```

Expected: FAIL because the new contracts and exact decimal helpers do not exist.

- [ ] **Step 3: Implement Zod contracts and install decimal.js**

Run:

```bash
npm install decimal.js@10.6.0
```

Create one cloned Decimal constructor with precision 40 and
`ROUND_HALF_EVEN`. All public valuation helpers accept strings and return normalized strings; reject `NaN`, infinity, an empty string, and negative values when the formula domain forbids them.

Define `Fact`, `Assumption`, `Calculation`, `FrameworkJudgment`,
`FinalSynthesis`, `ClaimEdge`, `SourceRevision`, `FundPolicySnapshot`,
`ResolvedUnderwritingContext`, `EvidencePack`, `UnderwritingBatch`,
`UnderwritingSelection`, `CandidateRun`, `ValuationEvaluation`,
`DecisionResult`, and `ActionDraft` schemas in the two focused contract files.

- [ ] **Step 4: Verify GREEN and legacy compatibility**

Run:

```bash
node --import tsx --test tests/contracts/evidence.test.ts \
  tests/contracts/underwriting.test.ts tests/contracts/domain.test.ts \
  tests/unit/underwriting-numbers.test.ts
npm run typecheck
npm run lint
```

Expected: new contracts and unchanged legacy contract tests PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json lib/contracts lib/underwriting/numbers.ts tests/contracts tests/unit/underwriting-numbers.test.ts
git commit -m "feat(underwriting): add evidence and decimal contracts"
```

---

### Task 5: Build immutable Source Revision and unified Deal Registry

**Files:**
- Create: `drizzle/0009_source_revision_deal_registry.sql`
- Modify: `db/schema.ts`
- Create: `db/repositories/source-registry.ts`
- Create: `db/repositories/deal-registry.ts`
- Create: `scripts/backfill-source-registry.ts`
- Modify: `scripts/seed-demo.ts`
- Modify: `lib/corpus/service.ts`
- Modify: `db/repositories/intelligence.ts`
- Test: `tests/unit/source-registry.test.ts`
- Test: `tests/unit/deal-registry.test.ts`
- Modify: `tests/unit/intelligence-repository.test.ts`
- Modify: `tests/integration/schema-migrations.test.ts`

**Interfaces:**

```ts
export interface SourceRegistry {
  createInitialRevision(input: CreateSourceRevisionInput): Promise<SourceRevision>;
  appendRevision(input: AppendSourceRevisionInput): Promise<SourceRevision>;
  getRevision(input: { workspaceId: string; revisionId: string }): Promise<SourceRevision | null>;
  annotateRevision(input: {
    workspaceId: string;
    revisionId: string;
    kind: "retracted" | "identity_corrected" | "superseded";
    reason: string;
    supersededByRunId: string | null;
  }): Promise<void>;
}

export interface RegisteredDeal {
  id: string;
  workspaceId: string;
  companyId: string;
  companyName: string;
  status: DealStatus;
  analysisEligibleAt: string | null;
  activeSourceRevisionFingerprint: string | null;
  activeSourceRevisionIds: string[];
}

export interface DealRegistry {
  listAnalysisEligibleBundles(workspaceId: string): Promise<DealMemoryBundle[]>;
  findForWorkspace(input: { workspaceId: string; dealId: string }): Promise<RegisteredDeal | null>;
  confirmSourceAssignment(input: ConfirmSourceAssignmentInput): Promise<{
    deal: RegisteredDeal;
    sourceRevision: SourceRevision;
    newlyEligible: boolean;
  }>;
}
```

- [ ] **Step 1: Write failing registry behavior tests**

```ts
test("seed and confirmed upload share one analysis-eligible query", async () => {
  const registry = createInMemoryDealRegistry(seedDealFixtures());
  await registry.confirmSourceAssignment(confirmedUploadFixture({ dealId: "deal_uploaded" }));
  const ids = (await registry.listAnalysisEligibleBundles("workspace_demo")).map((item) => item.dealId);
  assert.equal(ids.includes("deal_seed_7bridges"), true);
  assert.equal(ids.includes("deal_uploaded"), true);
});

test("a correction appends revision two without changing revision one", async () => {
  const first = await registry.createInitialRevision(sourceRevisionInput("hash_a"));
  const second = await registry.appendRevision({ ...sourceRevisionInput("hash_b"), supersedesRevisionId: first.id });
  assert.equal(first.revision, 1);
  assert.equal(second.revision, 2);
  assert.equal((await registry.getRevision({ workspaceId: first.workspaceId, revisionId: first.id }))?.contentHash, "hash_a");
});

test("report validation accepts an eligible count other than nineteen", () => {
  assert.doesNotThrow(() => parseCompanyAnalyses(companyAnalysesFixture(3), 3));
});
```

- [ ] **Step 2: Run and verify RED**

Run:

```bash
node --import tsx --test tests/unit/source-registry.test.ts \
  tests/unit/deal-registry.test.ts tests/unit/intelligence-repository.test.ts
```

Expected: FAIL because registries, `analysis_eligible_at`, and dynamic report cardinality do not exist.

- [ ] **Step 3: Implement append-only migration, repositories, and backfill**

`0009` creates `source_revisions`, `source_revision_annotations`,
`deal_source_assignments`; adds `analysis_eligible_at` and
`active_source_revision_fingerprint` to Deals. `deal_source_assignments`
stores `assigned_by_user_id`, reason, created time and optional superseded time.

Backfill every preloaded source as revision `1`, connect existing Deal evidence,
and mark the current seed Deals eligible. Keep a fixture assertion that this
specific seed produces 19, but repository validity compares persisted
CompanyAnalysis count with the eligible snapshot count captured by the run.

- [ ] **Step 4: Verify migration and repository GREEN**

Run:

```bash
node --import tsx --test tests/unit/source-registry.test.ts \
  tests/unit/deal-registry.test.ts tests/unit/intelligence-repository.test.ts \
  tests/integration/schema-migrations.test.ts tests/integration/seed-demo.test.ts
npm run typecheck
npm run lint
```

Expected: all listed tests PASS; seed test reports 19 as fixture data, not a universal invariant.

- [ ] **Step 5: Commit**

```bash
git add drizzle/0009_source_revision_deal_registry.sql db/schema.ts \
  db/repositories/source-registry.ts db/repositories/deal-registry.ts \
  scripts/backfill-source-registry.ts scripts/seed-demo.ts lib/corpus/service.ts \
  db/repositories/intelligence.ts tests/unit/source-registry.test.ts \
  tests/unit/deal-registry.test.ts tests/unit/intelligence-repository.test.ts \
  tests/integration/schema-migrations.test.ts tests/integration/seed-demo.test.ts
git commit -m "feat(registry): unify seeded and confirmed Deal evidence"
```

---

### Task 6: Promote confirmed uploads atomically, then ingest XTrace

**Files:**
- Create: `app/api/uploads/route.ts`
- Create: `app/api/uploads/[id]/route.ts`
- Create: `app/api/uploads/[id]/confirm/route.ts`
- Create: `app/api/source-revisions/[id]/access/route.ts`
- Remove: `app/api/documents/upload/route.ts`
- Remove: `app/api/documents/uploaded/route.ts`
- Create: `lib/uploads/confirmation.ts`
- Create: `worker/ingest-confirmed-source.ts`
- Modify: `worker/runner.ts`
- Modify: `db/repositories/uploaded-documents.ts`
- Modify: `db/repositories/xtrace-lineage.ts`
- Modify: `lib/xtrace/service.ts`
- Test: `tests/unit/upload-confirmation.test.ts`
- Test: `tests/unit/xtrace-confirmed-source.test.ts`
- Test: `tests/integration/upload-confirmation-flow.test.ts`

**Interfaces:**

```text
POST /api/uploads
  -> 202 { data: { uploadId, status: "queued" } }
GET /api/uploads/:id
  -> 200 { data: UploadPreviewDto }
POST /api/uploads/:id/confirm
  body ConfirmUpload
  -> 200 { data: { uploadId, dealId, sourceRevisionId, status: "confirmed" } }
GET /api/source-revisions/:id/access
  -> 200 { data: { url, expiresAt } }
```

```ts
export interface XTraceIngestLineage {
  sourceRevisionIds: string[];
  sourceIds: string[];
  fixtureIds: string[];
}
```

- [ ] **Step 1: Write failing confirmation, security, and concurrency tests**

Assert that preview creates zero Deal/XTrace writes; existing/new Deal confirmation uses the chosen identity; replay is idempotent; promotion creates source revision + assignment + eligibility in one transaction; only after confirmation does XTrace receive source-revision lineage; public demo returns 403; cross-workspace signed access returns 404/403; two workers cannot claim one upload and an expired lease can be reclaimed.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
node --import tsx --test tests/unit/upload-confirmation.test.ts \
  tests/unit/xtrace-confirmed-source.test.ts tests/integration/upload-confirmation-flow.test.ts
```

Expected: FAIL because preview confirmation routes, atomic promotion and revision-backed XTrace ingestion do not exist.

- [ ] **Step 3: Implement public DTOs, atomic claims, confirmation, and post-confirm ingest**

Add `claim_next_uploaded_document` and `renew_uploaded_document_lease` RPCs
to `0007` using `FOR UPDATE SKIP LOCKED`; completion/failure must match
worker ID and lease token. `confirmSourceAssignment` is idempotent by
workspace + staging upload + content hash.

`GET /api/uploads/:id` returns only status, safe filename, MIME, preview,
candidate Deal choices and sanitized failure. It never returns checksum,
object key, worker/lease, provider job ID or recalled memory.

Worker sequence:

```ts
extractNextUpload(): queued -> extracting -> awaiting_confirmation
confirmUpload(): awaiting_confirmation -> confirmed
ingestNextConfirmedUpload(): confirmed -> ingesting_memory -> ready
```

An XTrace service failure leaves a visible retryable state and never silently substitutes local memory.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
node --import tsx --test tests/unit/upload-confirmation.test.ts \
  tests/unit/xtrace-confirmed-source.test.ts tests/integration/upload-confirmation-flow.test.ts \
  tests/unit/xtrace-service.test.ts tests/unit/worker-runner.test.ts
npm run typecheck
npm run lint
```

Expected: all listed checks PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/uploads app/api/source-revisions app/api/documents \
  lib/uploads db/repositories/uploaded-documents.ts db/repositories/xtrace-lineage.ts \
  lib/xtrace/service.ts worker/ingest-confirmed-source.ts worker/runner.ts \
  drizzle/0007_uploaded_documents.sql tests/unit/upload-confirmation.test.ts \
  tests/unit/xtrace-confirmed-source.test.ts tests/integration/upload-confirmation-flow.test.ts
git commit -m "feat(upload): confirm sources before Deal memory ingestion"
```

---

### Task 7: Seed versioned Fund Policy, Benchmark, Context, Framework, and Decision registries

**Files:**
- Create: `drizzle/0010_underwriting_references.sql`
- Modify: `db/schema.ts`
- Create: `db/repositories/underwriting-references.ts`
- Create: `lib/underwriting/references/service.ts`
- Create: `seed/underwriting/balanced-policy-v1.ts`
- Create: `seed/underwriting/slice-one-contexts-v1.ts`
- Create: `seed/underwriting/framework-pack-v1.ts`
- Create: `app/api/fund-policy/route.ts`
- Create: `app/api/fund-policy/apply-recommended/route.ts`
- Create: `app/api/fund-policy/versions/route.ts`
- Test: `tests/unit/underwriting-references.test.ts`
- Test: `tests/integration/underwriting-reference-migration.test.ts`
- Test: `tests/integration/fund-policy-route.test.ts`

**Interfaces:**

```ts
export type ContextKey = {
  stage: "seed" | "series_a";
  businessModel: "b2b_saas" | "enterprise_ai";
  geography: "us" | "global";
  securityType: "preferred";
  asOfDate: string;
};

export interface PolicyFieldDiff {
  field: string;
  previousValue: string | string[] | boolean | null;
  recommendedValue: string | string[] | boolean | null;
  source: "recommended_policy";
}

export interface UnderwritingReferencesRepository {
  activeFundPolicy(workspaceId: string): Promise<FundPolicySnapshot>;
  applyBalancedDefaults(input: {
    workspaceId: string;
    actorId: string;
    expectedActiveVersionId: string | null;
  }): Promise<{ snapshot: FundPolicySnapshot; overwrittenDiff: PolicyFieldDiff[] }>;
  restorePolicyVersion(input: {
    workspaceId: string;
    actorId: string;
    versionId: string;
  }): Promise<FundPolicySnapshot>;
  resolveContext(input: ContextKey): Promise<
    | { kind: "resolved"; value: ResolvedUnderwritingContext }
    | { kind: "needs_confirmation"; fields: Array<"stage" | "businessModel" | "geography" | "securityType"> }
    | { kind: "unsupported"; reason: string }
  >;
}
```

Balanced Recommended Policy v1 uses explicit recommended assumptions:

```ts
{
  id: "fund_policy_balanced_us_software_v1",
  riskPreference: "balanced",
  baseCurrency: "USD",
  stageMandate: ["seed", "series_a"],
  businessModelMandate: ["b2b_saas", "enterprise_ai"],
  geographyMandate: ["global"],
  committedFundSize: "200000000",
  remainingDeployableCapital: "140000000",
  initialCheckMin: "1500000",
  initialCheckMax: "8000000",
  targetOwnership: "0.10",
  targetOwnershipMin: "0.075",
  targetOwnershipMax: "0.15",
  hardMinimumOwnership: null,
  reserveMultipleOfInitialCheck: "1.0",
  portfolioConcentrationLimit: "0.10",
  returnTargets: {
    seed: { grossMoic: "5", grossIrr: "0.2228445449938519", horizonYears: "8" },
    series_a: { grossMoic: "3", grossIrr: "0.169930812758687", horizonYears: "7" }
  },
  scenarioPriceMultipliers: { bear: "0.75", base: "1", bull: "1.25" },
  valuationPremiumReviewThreshold: "0.25",
  valuationPremiumBlockerThreshold: "0.50",
  acceptableFutureDilution: "0.50",
  humanFinalApproval: true,
  externalActionMode: "draft_only"
}
```

Every field is marked `recommended_policy`, not company Fact or observed Benchmark.
The $200M fund size, $140M remaining capital and check/ownership/return rules are
an editable lead/co-lead starter profile, not claims about the user's actual fund.
Benchmark entries separately carry provider, URL, cohort, geography, metric
definition, observation/publication/retrieval/effective dates, sample notes,
pre/post-money definition and stale threshold. Only published Framework Cards
can enter `framework_pack_universal_saas_ai_v1`.

- [ ] **Step 1: Write failing registry and policy route tests**

Test a new workspace resolving Balanced v1, one-click apply creating a new immutable active version, custom diff before overwrite, restore creating another immutable version, Seed B2B SaaS and Series A Enterprise AI resolving distinct profiles/packs, unsupported context failing closed, later benchmark/policy updates not changing old snapshots, and public demo mutation returning 403. Add a negative test proving a workspace owner cannot fetch a licensed framework body or platform source object even when it knows the framework source ID.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
node --import tsx --test tests/unit/underwriting-references.test.ts \
  tests/integration/underwriting-reference-migration.test.ts \
  tests/integration/fund-policy-route.test.ts
```

Expected: FAIL because versioned registries and Fund Policy endpoints do not exist.

- [ ] **Step 3: Implement migration, immutable seed packs, service, and API**

`0009` creates immutable `benchmark_packs`, `benchmark_entries`,
`fund_policy_versions`, `underwriting_contexts`,
`critical_evidence_profiles`, `valuation_method_policies`,
`decision_policies`, `framework_sources`, `framework_cards`,
`framework_packs`, and pack-card join rows.

`framework_sources`, original bodies, supporting passages and authoring review
are platform-scoped, not workspace-scoped. RLS/service boundaries allow only
the platform-admin worker to create/read those records or their private object
keys. A workspace stores only an immutable published `framework_pack_id`
reference and may read attribution, approved neutral paraphrase, locator,
limitations, rights status and version. It cannot obtain a licensed body,
download URL or admin review note. `administerFrameworks` is reserved for a
separate platform-admin context and remains false for ordinary
owner/partner/associate principals and for `public_demo`.

Seed exactly the four supported context combinations:
Seed／Series A × B2B SaaS／Enterprise AI, with US and Global variants that
must each record whether the selected pricing reference is exact, broad-but-
compatible, adjacent-only, or unavailable. If the benchmark is absent, stale,
adjacent-only, or incompatible, return it as unavailable for the formal price
gate and apply the configured ceiling; never borrow a neighboring cohort.

Seed the following current market pack without averaging incompatible cohorts:

```ts
{
  id: "carta_us_software_primary_2026h1_v1",
  provider: "Carta",
  sourceUrl: "https://carta.com/data/linkedin-vc-fundraising-benchmarks-2026/",
  publishedAt: "2026-07-10",
  retrievalDate: "2026-07-28",
  geography: "US",
  sector: "software",
  observationWindow: "most recent six months reported by source",
  sampleNotes: "More than 1,000 primary rounds on Carta; bridge and extension rounds excluded",
  staleAfterDays: 180,
  entries: [
    { stage: "seed", metric: "reported_valuation", value: "24300000", valuationBasis: "reported_unspecified", currency: "USD" },
    { stage: "seed", metric: "round_size", value: "4100000", currency: "USD" },
    { stage: "seed", metric: "dilution", value: "0.18" },
    { stage: "series_a", metric: "reported_valuation", value: "80000000", valuationBasis: "post_money_inferred_from_round_and_dilution", currency: "USD" },
    { stage: "series_a", metric: "round_size", value: "14400000", currency: "USD" },
    { stage: "series_a", metric: "dilution", value: "0.18" }
  ]
}
```

Seed a cross-check pack, not a replacement for the Software cohort:

```ts
{
  id: "nvca_pitchbook_us_all_sector_2025_v1",
  provider: "NVCA / PitchBook",
  sourceUrl: "https://nvca.org/wp-content/uploads/2026/04/NVCA-2026-Yearbook-4.9.26.pdf",
  publishedAt: "2026-04-09",
  retrievalDate: "2026-07-28",
  geography: "US",
  sector: "all_sectors",
  observationWindow: "2025 calendar year",
  entries: [
    { stage: "seed", metric: "pre_money_valuation", value: "16000000", currency: "USD" },
    { stage: "series_a", metric: "pre_money_valuation", value: "49000000", currency: "USD" }
  ]
}
```

The Carta Seed valuation remains `reported_unspecified`; it cannot be mixed
with a pre-money formula. The Series A basis is stored as inferred, not quoted.
The NVCA pre-money values cannot be combined with Carta round size/dilution.
Global candidates can use both packs as market context but not as a formal
global pricing gate. Enterprise AI may use the Software cohort only when the
confirmed revenue model is software and the context resolver records
`broad_compatible`; foundational-model valuations must never be used as a
proxy for ordinary Enterprise AI.

The eight published universal cards are:
Market Size & Why Now; Founder & Unique Insight; Product-Market Fit &
Customer Evidence; Contrarian Monopoly; Durable Competitive Power;
GTM & Unit Economics; Revenue Quality & Retention; Valuation & Fund Return.
The initial published cards use neutral paraphrases derived from these
auditable public sources:

```text
Stanford GSB — Make Decisions with a VC Mindset
https://www.gsb.stanford.edu/faculty-research/publications/make-decisions-vc-mindset

Sequoia Capital — The Arc Product-Market Fit Framework
https://sequoiacap.com/article/pmf-framework/

Sequoia Capital — Measuring Product Health
https://articles.sequoiacap.com/measuring-product-health

Y Combinator / Stanford CS183B — Competition is for Losers, Peter Thiel
https://www.youtube.com/watch?v=3Fx5Q8xGU8k

Hamilton Helmer — 7 Powers official synopsis
https://7powers.com/

Bessemer Venture Partners — State of the Cloud 2023
https://www.bvp.com/atlas/state-of-the-cloud-2023

Bessemer Venture Partners — State of the Cloud 2024
https://www.bvp.com/atlas/state-of-the-cloud-2024

Bessemer Venture Partners — The State of AI 2025
https://www.bvp.com/atlas/the-state-of-ai-2025

Aswath Damodaran — Private Firm Expansion / Venture Capital Method
https://pages.stern.nyu.edu/adamodar/New_Home_Page/invfables/privateequity.htm

Aswath Damodaran — An Introduction to Valuation
https://pages.stern.nyu.edu/~adamodar/New_Home_Page/background/valintro.htm
```

`Contrarian Monopoly` is labeled as a product lens informed by Peter Thiel's
public monopoly/competition teaching, not as a Peter Thiel persona. Its source
revision is the official Y Combinator lecture recording above; the seed
authoring step stores the video ID, title, retrieved caption hash, and exact
caption start/end timestamps used for each neutral paraphrase. The migration
must fail rather than publish the card if the reviewed timestamped source
revision is absent. No unverified transcript mirror enters the pack.

The B2B SaaS／Enterprise AI specialist pack explicitly evaluates:

```text
ARR definition; recurring/services/pass-through split; ARR growth; GRR; NRR;
logo retention; gross margin; contribution margin; CAC payback; LTV/CAC;
founder-led-sales limitation; pilot-to-paid; POC-to-production; time-to-value;
sales cycle; pipeline; win/loss; rep ramp; quota attainment;
customer concentration; burn multiple; efficiency; runway; FCF path;
inference/model-API cost; human review/FDE/custom implementation burden;
task-level margin; eval design; quality drift; fallback; data rights;
security/compliance; model-provider concentration; workflow/data/distribution/
switching-cost moat.
```

Cards store neutral paraphrase, attribution, applicability, required evidence,
positive/red flags, disconfirming evidence, confidence anchors, rights status
and source version; no full copyrighted text. A card not in `published` state
cannot execute and its absence is visible to the Decision Policy.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
node --import tsx --test tests/unit/underwriting-references.test.ts \
  tests/integration/underwriting-reference-migration.test.ts \
  tests/integration/fund-policy-route.test.ts
npm run typecheck
npm run lint
```

Expected: all listed checks PASS.

- [ ] **Step 5: Commit**

```bash
git add drizzle/0010_underwriting_references.sql db/schema.ts \
  db/repositories/underwriting-references.ts lib/underwriting/references \
  seed/underwriting app/api/fund-policy tests/unit/underwriting-references.test.ts \
  tests/integration/underwriting-reference-migration.test.ts \
  tests/integration/fund-policy-route.test.ts
git commit -m "feat(policy): add versioned underwriting reference packs"
```

---

### Task 8: Persist idempotent batches, selections, candidates, checkpoints, and atomic artifacts

**Files:**
- Create: `drizzle/0011_underwriting_runs.sql`
- Modify: `db/schema.ts`
- Create: `db/repositories/underwriting-runs.ts`
- Create: `db/repositories/underwriting-artifacts.ts`
- Create: `lib/underwriting/fingerprints.ts`
- Test: `tests/unit/underwriting-fingerprints.test.ts`
- Test: `tests/unit/underwriting-runs.test.ts`
- Test: `tests/integration/underwriting-finalization.test.ts`

**Interfaces:**

```ts
export type CandidateStatus =
  | "queued"
  | "running"
  | "partial"
  | "completed"
  | "unavailable"
  | "failed";

export type UnderwritingSelectionStatus = "selected" | "not_selected";

export interface UnderwritingRunsRepository {
  createOrReuseBatch(input: CreateBatchInput): Promise<UnderwritingBatch>;
  saveSelections(input: {
    batchId: string;
    selections: Array<{ dealId: string; status: UnderwritingSelectionStatus; rank: number | null; reason: string }>;
  }): Promise<void>;
  createSelectedCandidates(input: { batchId: string; dealIds: string[] }): Promise<CandidateRun[]>;
  claimNextCandidate(input: { workerId: string; leaseSeconds: number }): Promise<CandidateRun | null>;
  saveCheckpoint(input: CandidateCheckpoint): Promise<void>;
  markCandidateUnavailable(input: { candidateRunId: string; reasonCodes: string[] }): Promise<void>;
  markCandidateFailed(input: { candidateRunId: string; publicReason: string }): Promise<void>;
  finalizeCandidate(input: CandidateFinalization): Promise<CandidateRun>;
}

export interface CreateBatchInput {
  workspaceId: string;
  scanRunId: string;
  batchInputFingerprint: string;
  fundPolicySnapshotId: string;
  forceRefresh: boolean;
  refreshNonce: string | null;
  rerunOfId: string | null;
}

export interface CandidateFinalization {
  workerId: string;
  leaseToken: string;
  candidateRunId: string;
  candidateAnalysisFingerprint: string;
  evidencePack: EvidencePack;
  context: ResolvedUnderwritingContext;
  scenarioModel: ScenarioModel;
  calculations: Calculation[];
  judgments: FrameworkJudgment[];
  disagreements: FrameworkDisagreement[];
  valuation: ValuationEvaluation;
  decision: DecisionResult;
  narrative: string;
  actionDrafts: ActionDraft[];
  versionSnapshot: {
    fundPolicyId: string;
    benchmarkPackId: string | null;
    frameworkPackId: string;
    routerVersion: string;
    criticalEvidenceProfileId: string;
    valuationMethodPolicyId: string;
    decisionPolicyId: string;
    formulaVersions: string[];
    providerModel: string;
    promptVersion: string;
    schemaVersion: string;
    settingsFingerprint: string;
    applicationCommit: string;
  };
}
```

- [ ] **Step 1: Write failing idempotency and atomicity tests**

Test that the same `batchInputFingerprint` reuses one batch; `forceRefresh`
creates a new batch with `rerunOfId`; ranks 6+ get selection
`not_selected` and no CandidateRun; candidate fingerprint reuse makes zero
new LLM/formula calls; failed finalization leaves no partial artifact rows;
one candidate failure leaves another completed and batch `partial`.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
node --import tsx --test tests/unit/underwriting-fingerprints.test.ts \
  tests/unit/underwriting-runs.test.ts tests/integration/underwriting-finalization.test.ts
```

Expected: FAIL because batch persistence and atomic finalization do not exist.

- [ ] **Step 3: Implement versioned fingerprints and finalization RPC**

`batchInputFingerprint` includes workspace, 14-day window, immutable market
snapshot, eligible Deal revision set, XTrace lineage snapshot, selected
events, matching model/prompt/schema, scoring/selection policy, matching
judgment, Fund Policy snapshot, Framework/Router/Decision versions.

`candidateAnalysisFingerprint` additionally includes Deal revision,
Evidence Pack/source IDs, candidate context, Critical Evidence, Benchmark,
Valuation Method, Formula, provider model, prompt/schema/settings.

`finalize_candidate_underwriting` validates candidate lease ownership, inserts
all immutable artifacts and claim edges in one transaction, then marks the
candidate completed. It does not call or replace legacy
`save_intelligence_report`.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
node --import tsx --test tests/unit/underwriting-fingerprints.test.ts \
  tests/unit/underwriting-runs.test.ts tests/integration/underwriting-finalization.test.ts
npm run typecheck
npm run lint
```

Expected: all checks PASS.

- [ ] **Step 5: Commit**

```bash
git add drizzle/0011_underwriting_runs.sql db/schema.ts \
  db/repositories/underwriting-runs.ts db/repositories/underwriting-artifacts.ts \
  lib/underwriting/fingerprints.ts tests/unit/underwriting-fingerprints.test.ts \
  tests/unit/underwriting-runs.test.ts tests/integration/underwriting-finalization.test.ts
git commit -m "feat(underwriting): persist idempotent candidate artifacts"
```

---

### Task 9: Build the sole Evidence Pack input and deterministic Context Router

**Files:**
- Create: `lib/underwriting/evidence/normalization.ts`
- Create: `lib/underwriting/evidence/conflicts.ts`
- Create: `lib/underwriting/evidence/builder.ts`
- Create: `lib/underwriting/router.ts`
- Create: `db/repositories/evidence-packs.ts`
- Test: `tests/unit/evidence-normalization.test.ts`
- Test: `tests/unit/evidence-pack.test.ts`
- Test: `tests/unit/router-critical-evidence.test.ts`
- Test: `tests/integration/evidence-pack-provenance.test.ts`

**Interfaces:**

```ts
export interface EvidencePackBuilder {
  build(input: {
    workspaceId: string;
    dealId: string;
    asOfDate: string;
    sourceRevisionIds: string[];
    xtraceLineage: XTraceLineageSnapshot;
    context: ResolvedUnderwritingContext;
  }): Promise<EvidencePack>;
}

export interface ContextRouter {
  resolve(input: CandidateIdentityEvidence): RouterResolution;
  evaluateCoverage(input: {
    pack: EvidencePack;
    profile: CriticalEvidenceProfile;
  }): EvidenceCoverageResult;
}
```

- [ ] **Step 1: Write failing normalization, conflict, lineage, and ceiling tests**

Use literal fixtures to prove ARR cannot merge with pipeline/GMV/revenue;
recurring/services/pass-through remain separate; two material ARR values
produce one open conflict rather than selecting the favorable value;
management-reported and verified statuses remain distinct; every Fact
retains exact source revision/locator/hash/time/extractor; recalled-only
text is rejected; ambiguous context needs user confirmation; missing identity
is unavailable; missing round price produces an `Advance` ceiling.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
node --import tsx --test tests/unit/evidence-normalization.test.ts \
  tests/unit/evidence-pack.test.ts tests/unit/router-critical-evidence.test.ts \
  tests/integration/evidence-pack-provenance.test.ts
```

Expected: FAIL because builder/router do not exist.

- [ ] **Step 3: Implement builder, typed conflicts, coverage, and fail-closed routing**

Normalize currency, period, rate and metric definition before comparing.
Each field uses versioned tolerance/materiality. Persist conflict status
`open／resolved／immaterial`, both values, both sources and resolution reason.
Only critical material open conflicts become blockers.

Router precedence uses confirmed values, then source-explicit values, then
derived values. Conflicting primary stage/model/geography/security returns
`needs_confirmation`; it never chooses the nearest cohort. Unsupported
context returns Core-only with at most `Advance` unless a published critical
profile, valuation policy and compatible benchmark all exist.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
node --import tsx --test tests/unit/evidence-normalization.test.ts \
  tests/unit/evidence-pack.test.ts tests/unit/router-critical-evidence.test.ts \
  tests/integration/evidence-pack-provenance.test.ts
npm run typecheck
npm run lint
```

Expected: all checks PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/underwriting/evidence lib/underwriting/router.ts \
  db/repositories/evidence-packs.ts tests/unit/evidence-normalization.test.ts \
  tests/unit/evidence-pack.test.ts tests/unit/router-critical-evidence.test.ts \
  tests/integration/evidence-pack-provenance.test.ts
git commit -m "feat(evidence): build source-grounded Evidence Packs"
```

---

### Task 10: Implement deterministic Slice-1 valuation and return models

**Files:**
- Create: `lib/underwriting/valuation/contracts.ts`
- Create: `lib/underwriting/valuation/scenarios.ts`
- Create: `lib/underwriting/valuation/market-comps.ts`
- Create: `lib/underwriting/valuation/venture-method.ts`
- Create: `lib/underwriting/valuation/ownership.ts`
- Create: `lib/underwriting/valuation/returns.ts`
- Create: `lib/underwriting/valuation/service.ts`
- Test: `tests/unit/valuation/market-comps.test.ts`
- Test: `tests/unit/valuation/venture-method.test.ts`
- Test: `tests/unit/valuation/ownership.test.ts`
- Test: `tests/unit/valuation/returns.test.ts`
- Test: `tests/unit/valuation/service.test.ts`

**Interfaces:**

```ts
export interface ValuationEngine {
  evaluate(input: {
    pack: EvidencePack;
    context: ResolvedUnderwritingContext;
    fundPolicy: FundPolicySnapshot;
  }): ValuationEvaluation;
}

export type FormulaStatus =
  | "completed"
  | "not_applicable"
  | "insufficient_input"
  | "unsupported_terms"
  | "invalid_domain"
  | "stale_benchmark";
```

- [ ] **Step 1: Write failing formula tests with hand-calculated literals**

```ts
test("computes simple post-money ownership exactly", () => {
  assert.deepEqual(
    computeOwnership({ investment: "2000000", preMoney: "18000000" }),
    { postMoney: "20000000", initialOwnership: "0.1" },
  );
});

test("computes post-dilution ownership without binary-float drift", () => {
  assert.equal(applyFutureDilution("0.1", "0.35"), "0.065");
});

test("computes gross MOIC and annualized IRR", () => {
  const result = computeGrossReturns({
    invested: "2000000",
    proceeds: "10000000",
    holdingYears: "5",
  });
  assert.equal(result.moic, "5");
  assert.equal(result.irrRoundedForDisplay, "0.3797");
});
```

Add tests for market comp Bear ≤ Base ≤ Bull, VC Method maximum acceptable
entry value, stale/mismatched comp, zero/negative domains, unsupported terms,
unknown never becoming zero, probability weights not totaling 1, and no net
fund return output. Add one test that every Bear/Base/Bull model persists all
required revenue/ARR, growth, margin, cash/burn/runway, financing/dilution,
exit timing/method/multiple and success/failure fields; absent inputs must be
`value = null` with a non-empty `unavailableReason`, never omitted.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
node --import tsx --test tests/unit/valuation
```

Expected: FAIL because valuation modules do not exist.

- [ ] **Step 3: Implement the exact deterministic formulas**

Every `CalculationResult` stores formula ID/version, typed input IDs and
values, unit/currency/period, output, rounding policy and computed time.
Use decimal strings for all intermediate values. Implement only:

```text
market_comps_v1
venture_return_method_v1
simple_pre_post_ownership_v1
future_dilution_v1
gross_deal_moic_v1
annualized_gross_irr_v1
```

`scenarios.ts` creates exactly Bear, Base and Bull from accepted source Facts
plus explicit Assumptions. Each scenario persists the complete
`ScenarioInput` field set from Task 4. A source-backed value points to
`evidenceItemId`; a modeled value points to `assumptionItemId`; an unknown
uses neither and records why it is unavailable. The default policy is not
probability-weighted. If a future policy enables weighting, the three decimal
probabilities must total exactly `"1"` before any weighted output is produced.

The formulas are fixed as:

```text
post_money = pre_money + investment
initial_ownership = investment / post_money
post_dilution_ownership = initial_ownership * (1 - future_dilution_rate)
exit_equity_value = exit_arr * selected_exit_arr_multiple
exit_proceeds = exit_equity_value * post_dilution_ownership
gross_moic = exit_proceeds / investment
gross_irr = gross_moic^(1 / holding_years) - 1
required_exit_proceeds = investment * target_gross_moic
required_post_dilution_ownership = required_exit_proceeds / exit_equity_value
required_initial_ownership = required_post_dilution_ownership / (1 - future_dilution_rate)
maximum_acceptable_post_money = investment / required_initial_ownership
maximum_acceptable_pre_money = maximum_acceptable_post_money - investment
pricing_premium = (current_reported_valuation / compatible_benchmark_value) - 1
```

Market-comps Bear/Base/Bull uses the preselected compatible benchmark value
multiplied by the immutable policy's `0.75／1.00／1.25` scenario multipliers.
Those multipliers are `recommended_policy` Assumptions, not observed market
Facts. A source-labeled valuation with unknown pre/post basis can support only
the pricing comparison; it cannot enter ownership or pre/post-money formulas.

Return explicit status for unavailable/unsupported models. Do not introduce
DCF, SAFE/note, option pool, preferred waterfall, FX or net fund math.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
node --import tsx --test tests/unit/valuation
npm run typecheck
npm run lint
```

Expected: all valuation tests PASS with exact string results.

- [ ] **Step 5: Commit**

```bash
git add lib/underwriting/valuation tests/unit/valuation
git commit -m "feat(valuation): add deterministic Slice-1 models"
```

---

### Task 11: Execute independent grounded framework lenses and preserve disagreements

**Files:**
- Create: `lib/underwriting/frameworks/schemas.ts`
- Create: `lib/underwriting/frameworks/grounding.ts`
- Create: `lib/underwriting/frameworks/claude-lens.ts`
- Create: `lib/underwriting/frameworks/disagreements.ts`
- Create: `lib/underwriting/frameworks/service.ts`
- Modify: `lib/claude/schemas.ts`
- Modify: `lib/claude/service.ts`
- Test: `tests/unit/framework-grounding.test.ts`
- Test: `tests/unit/framework-lens.test.ts`
- Test: `tests/unit/framework-disagreement.test.ts`

**Interfaces:**

```ts
export interface FrameworkLensService {
  runAll(input: {
    candidate: CandidateRun;
    pack: EvidencePack;
    context: ResolvedUnderwritingContext;
    calculations: Calculation[];
  }): Promise<{
    judgments: FrameworkJudgment[];
    disagreements: FrameworkDisagreement[];
  }>;
}
```

- [ ] **Step 1: Write failing applicability, grounding, repair, cache, and disagreement tests**

Test that only published/applicable cards run; non-applicable cards abstain;
each judgment contains strongest support, strongest counterevidence, unknown,
separate confidence dimensions and claim edges; ungrounded claims fail;
Valuation lens may reference saved calculation IDs but not recalculate;
malformed output gets exactly one repair; second failure persists unavailable;
same fingerprint makes zero additional Claude calls; opposing persisted
criteria create a disagreement containing both judgment IDs and are not averaged.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
node --import tsx --test tests/unit/framework-grounding.test.ts \
  tests/unit/framework-lens.test.ts tests/unit/framework-disagreement.test.ts
```

Expected: FAIL because lens service and validators do not exist.

- [ ] **Step 3: Implement bounded independent lens execution**

Each lens receives only its published Framework Card, the same immutable
Evidence Pack, and for Valuation & Fund Return only saved calculations and
immutable Policy/Benchmark refs. No lens has browsing/tool access or a
decision output field.

Fingerprint includes Evidence Pack, card version, provider/model,
prompt/schema/settings and application commit. Validate all evidence IDs and
framework rule refs. Save provider metadata without exposing prompts through
public serializers.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
node --import tsx --test tests/unit/framework-grounding.test.ts \
  tests/unit/framework-lens.test.ts tests/unit/framework-disagreement.test.ts \
  tests/unit/matching-reasoner.test.ts
npm run typecheck
npm run lint
```

Expected: lens and existing matching reasoner tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/underwriting/frameworks lib/claude/schemas.ts lib/claude/service.ts \
  tests/unit/framework-grounding.test.ts tests/unit/framework-lens.test.ts \
  tests/unit/framework-disagreement.test.ts
git commit -m "feat(frameworks): run grounded independent investment lenses"
```

---

### Task 12: Produce deterministic decisions, narrative, and draft-only actions

**Files:**
- Create: `lib/underwriting/decision/engine.ts`
- Create: `lib/underwriting/decision/rules.ts`
- Create: `lib/underwriting/narrative.ts`
- Create: `lib/underwriting/action-drafts.ts`
- Test: `tests/unit/decision-engine.test.ts`
- Test: `tests/unit/underwriting-narrative.test.ts`
- Test: `tests/unit/action-drafts.test.ts`

**Interfaces:**

```ts
export interface DecisionEngine {
  decide(input: {
    pack: EvidencePack;
    coverage: EvidenceCoverageResult;
    judgments: FrameworkJudgment[];
    valuation: ValuationEvaluation;
    fundPolicy: FundPolicySnapshot;
    context: ResolvedUnderwritingContext;
    decisionPolicy: DecisionPolicy;
  }): DecisionResult;
}

export interface ActionDraftGenerator {
  generate(input: {
    candidateRunId: string;
    decision: DecisionResult;
    missingEvidence: MissingEvidenceItem[];
    recommendedNextSteps: string[];
  }): ActionDraft[];
}
```

- [ ] **Step 1: Write failing decision-order and side-effect tests**

Test sufficient evidence can yield `Invest Candidate`; critical missing data
ceilings at `Advance`; minimum input missing yields unavailable/null; hard veto
is reproducible; attractive company at excessive price cannot pass
Price Attractiveness; company quality/price/fund fit remain separate;
`belief_revised` alone never yields Invest Candidate; changing LLM narrative
cannot alter decision; each fired rule saves typed inputs/results/ceiling/veto.

Test creation of five editable drafts:
email, SMS/short message, LinkedIn message, internal memo, DD request. Assert
the persisted object has no recipient, handle, delivery state, send method or
provider integration.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
node --import tsx --test tests/unit/decision-engine.test.ts \
  tests/unit/underwriting-narrative.test.ts tests/unit/action-drafts.test.ts
```

Expected: FAIL because decision/narrative/draft services do not exist.

- [ ] **Step 3: Implement the fixed decision sequence and constrained generation**

Execute:

```text
router/minimum input
-> Critical Evidence ceiling
-> mandate mismatch and hard veto
-> Company Quality / Price Attractiveness / Fund Fit
-> valuation / return / ownership / concentration rules
-> versioned decision matrix
```

Decision Policy v1 evaluates each dimension without averaging lens confidence:

```ts
type DimensionResult = "pass" | "mixed" | "fail" | "unavailable";

const decisionMatrixV1 = [
  { when: "minimum_model_input_missing", decision: null, status: "unavailable" },
  { when: "hard_veto_or_mandate_mismatch", decision: "Pass" },
  { when: "company_quality_fail", decision: "Pass" },
  { when: "company_quality_pass_and_price_fail", decision: "Watch" },
  { when: "company_quality_mixed_and_no_actionable_positive_signal", decision: "Watch" },
  { when: "all_three_dimensions_pass_and_critical_evidence_complete", decision: "Invest Candidate" },
  { when: "otherwise_actionable", decision: "Advance" }
] as const;
```

`Company Quality = pass` requires no negative mandatory lens and:

```text
Market Size & Why Now is supportive or mixed
Founder & Unique Insight is supportive or mixed
Product-Market Fit & Customer Evidence is supportive
at least two of those three are supportive
applicable specialist critical criteria contain no high-confidence negative
```

For Seed, a source-grounded production/paying/design-partner signal can make
PMF supportive; a market prior alone cannot. For Series A, PMF supportive
requires accepted customer plus revenue/ARR/retention evidence under the
Critical Evidence Profile.

`Price Attractiveness = pass` requires a compatible, non-stale price basis,
current ask at or below the deterministic maximum acceptable valuation,
Base gross MOIC and IRR at or above the stage target, and premium ≤ 25%.
Premium > 50%, or every scenario missing the return target, is `fail`;
the remaining supported cases are `mixed`.

`Fund Fit = pass` requires mandate match, check within $1.5M–$8M, modeled
initial ownership within 7.5%–15%, initial check plus 1.0x reserve within
10% of committed fund, and no hard veto. A miss of the non-hard ownership
target is `mixed`; mandate, concentration hard cap, unsupported payout terms
or an explicit user hard veto is `fail`.

Any critical evidence blocker applies `ceiling = Advance` before the matrix.
An adjacent/stale/unknown-basis sole pricing benchmark prevents
Price Attractiveness from passing. The engine applies the lower of matrix
decision and active ceiling and saves every rule ID and typed input reference.

Narrative receives only persisted facts, assumptions, calculations,
judgments, disagreements and decision result. It may explain but cannot
introduce new facts/numbers or update the formal result.

Drafts use `audience_type = founder | customer | internal`, editable body and
channel only. Existing `InternalReportDraft` stays browser-local and unchanged.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
node --import tsx --test tests/unit/decision-engine.test.ts \
  tests/unit/underwriting-narrative.test.ts tests/unit/action-drafts.test.ts \
  tests/unit/report-draft.test.ts
npm run typecheck
npm run lint
```

Expected: all checks PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/underwriting/decision lib/underwriting/narrative.ts \
  lib/underwriting/action-drafts.ts tests/unit/decision-engine.test.ts \
  tests/unit/underwriting-narrative.test.ts tests/unit/action-drafts.test.ts
git commit -m "feat(decision): add deterministic decisions and draft actions"
```

---

### Task 13: Orchestrate Top-5 underwriting after the existing market analysis

**Files:**
- Create: `lib/underwriting/orchestrator.ts`
- Modify: `worker/process-run.ts`
- Modify: `worker/runner.ts`
- Modify: `worker/stages/match-opportunities.ts`
- Modify: `lib/corpus/service.ts`
- Test: `tests/integration/process-run-underwriting.test.ts`
- Modify: `tests/integration/process-run.test.ts`
- Modify: `tests/unit/worker-runner.test.ts`

**Interfaces:**

```ts
export interface UnderwritingOrchestrator {
  createBatchAndSelections(input: {
    scanRun: RunRecord;
    report: IntelligenceReportRecord;
    analyses: CompanyAnalysis[];
    eligibleDeals: RegisteredDeal[];
    forceRefresh: boolean;
  }): Promise<UnderwritingBatch>;
  processCandidate(candidateRunId: string): Promise<CandidateRun>;
}

export interface ProcessRunDependencies {
  // existing runs/intelligence/importGate/market/reasoner/xtrace/now remain
  dealRegistry: Pick<DealRegistry, "listAnalysisEligibleBundles">;
  underwriting: UnderwritingOrchestrator;
}
```

- [ ] **Step 1: Write failing selection, partial-failure, and replay tests**

Test all eligible Deals retain CompanyAnalysis; only medium/high
`belief_revised` enter ranked selection; maximum five CandidateRuns;
every other eligible Deal receives `not_selected`; rank 6 is not `Pass`;
a candidate failure leaves prior candidate completed and batch partial;
XTrace partial recall is visible; identical fingerprint reuses calculations
and lens judgments; `force_refresh` creates linked rerun. Add one confirmed
uploaded Deal to the registry fixture and prove it receives CompanyAnalysis
and participates in ranking alongside seeded Deals.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
node --import tsx --test tests/integration/process-run-underwriting.test.ts
```

Expected: FAIL because the existing run stops after legacy report creation.

- [ ] **Step 3: Insert the candidate chain without replacing legacy stages**

Keep existing sequence through CompanyAnalysis/report. Immediately after the
ranked `projectRecommendedOpportunities()` seam:

```text
snapshot Fund Policy and eligible Deal revisions
-> create/reuse underwriting batch
-> save selected/not_selected rows for every eligible Deal
-> run at most 5 candidates with bounded concurrency
-> candidate: Evidence Pack -> Router -> valuation -> lenses ->
   disagreements -> deterministic decision -> narrative/drafts -> atomic finalization
-> batch completed or partial
```

Remove `bundles: DealMemoryBundle[]` from `ProcessRunDependencies`.
At the beginning of `processClaimedRun`, after the import gate succeeds, load:

```ts
const bundles = await dependencies.dealRegistry
  .listAnalysisEligibleBundles(claimedRun.workspaceId);
```

Use that local immutable snapshot for portfolio matching, XTrace recall,
CompanyAnalysis cardinality, batch fingerprint and selections. In
`worker/runner.ts`, replace `buildPreloadedDealMemoryBundles()` with the
workspace-scoped `DealRegistry`; the fixed manifest is used only by the seed
backfill/import gate. This is the only authoritative scan input.

Candidate stage timeout/retry/cost budget is explicit; a skipped lens or
candidate receives a truncation warning, never negative evidence.
The run continues to use the same 14-day market scan; no scheduled path is added.

- [ ] **Step 4: Verify GREEN and existing run behavior**

Run:

```bash
node --import tsx --test tests/integration/process-run-underwriting.test.ts \
  tests/integration/process-run.test.ts tests/unit/worker-runner.test.ts \
  tests/unit/worker-health.test.ts
npm run typecheck
npm run lint
```

Expected: new underwriting and existing worker tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/underwriting/orchestrator.ts worker/process-run.ts worker/runner.ts \
  worker/stages/match-opportunities.ts lib/corpus/service.ts \
  tests/integration/process-run-underwriting.test.ts tests/integration/process-run.test.ts \
  tests/unit/worker-runner.test.ts
git commit -m "feat(worker): orchestrate Top-5 auditable underwriting"
```

---

### Task 14: Attach immutable underwriting to reports, Chat, Search, and Action Draft APIs

**Files:**
- Create: `lib/underwriting/read-model.ts`
- Create: `app/api/reports/[id]/underwriting/[dealId]/route.ts`
- Create: `app/api/search/route.ts`
- Create: `app/api/action-drafts/route.ts`
- Create: `app/api/action-drafts/[id]/route.ts`
- Modify: `app/api/reports/[id]/route.ts`
- Modify: `lib/reports/public.ts`
- Modify: `lib/chat/report-evidence.ts`
- Modify: `lib/chat/service.ts`
- Modify: `lib/contracts/http.ts`
- Test: `tests/integration/underwriting-report-route.test.ts`
- Test: `tests/integration/action-drafts-route.test.ts`
- Test: `tests/unit/underwriting-chat-evidence.test.ts`
- Modify: `tests/integration/chat-route.test.ts`

**Interfaces:**

```ts
export interface IntelligenceReportView {
  // every existing field remains unchanged
  underwritingBatch?: UnderwritingBatchSummary;
}

export interface DealUnderwritingSelectionView {
  dealId: string;
  underwritingStatus:
    | "not_selected"
    | "queued"
    | "running"
    | "partial"
    | "completed"
    | "unavailable"
    | "failed";
  rank: number | null;
  candidateRunId: string | null;
  decision: "Pass" | "Watch" | "Advance" | "Invest Candidate" | null;
}

export interface UnderwritingBatchSummary {
  batchId: string;
  status: "queued" | "running" | "partial" | "completed" | "failed";
  selections: DealUnderwritingSelectionView[];
}
```

```text
GET /api/reports/:id/underwriting/:dealId
GET /api/search?q=<existing-data-only query>
GET /api/action-drafts?candidateRunId=<id>
PATCH /api/action-drafts/:id { body: string }
```

- [ ] **Step 1: Write failing backward-compatibility and read-only grounding tests**

Test old report JSON and old company-analysis endpoint remain valid without
underwriting; a report optionally attaches batch summary; candidate detail
returns all five analysis types, claim edges, source revisions and version
snapshots; every eligible Deal receives an explicit `underwritingStatus` and
an unselected row returns `not_selected` with null candidate/decision; action draft PATCH edits body but
no send/publish route exists; Chat/Search only query finalized persisted
artifacts; every factual answer has claim-level citation; Chat cannot browse,
run, recalculate, mutate policy or create draft.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
node --import tsx --test tests/integration/underwriting-report-route.test.ts \
  tests/integration/action-drafts-route.test.ts tests/unit/underwriting-chat-evidence.test.ts
```

Expected: FAIL because underwriting read models/endpoints do not exist.

- [ ] **Step 3: Implement composite read models and safe serializers**

Keep `GET /api/reports/[id]/companies/[dealId]` returning the legacy
CompanyAnalysis contract. Candidate detail uses a separate route.
Sanitize all provider metadata and private storage fields.

Extend `ChatEvidence` with immutable item ID, `analysisType`, claim edge and
source revision refs. Chat/Search only consume `completed`/`partial` finalized
candidate artifacts; no tool invocation or formula service is reachable from
these read paths.

- [ ] **Step 4: Verify GREEN and old report/chat regressions**

Run:

```bash
node --import tsx --test tests/integration/underwriting-report-route.test.ts \
  tests/integration/action-drafts-route.test.ts tests/unit/underwriting-chat-evidence.test.ts \
  tests/integration/reports-route.test.ts tests/integration/company-analyses-route.test.ts \
  tests/unit/report-chat-evidence.test.ts tests/unit/chat-service.test.ts
npm run typecheck
npm run lint
```

Expected: new and legacy read paths PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/underwriting/read-model.ts app/api/reports app/api/search \
  app/api/action-drafts lib/reports/public.ts lib/chat lib/contracts/http.ts \
  tests/integration/underwriting-report-route.test.ts \
  tests/integration/action-drafts-route.test.ts tests/unit/underwriting-chat-evidence.test.ts \
  tests/integration/chat-route.test.ts
git commit -m "feat(api): expose persisted underwriting and draft artifacts"
```

---

### Task 15: Integrate Fund Policy, upload confirmation, underwriting, and drafts into the existing UI

**Files:**
- Create: `app/fund-policy.tsx`
- Create: `app/source-upload-flow.tsx`
- Create: `app/underwriting-summary.tsx`
- Create: `app/underwriting-detail.tsx`
- Create: `app/action-draft-dialog.tsx`
- Modify: `app/page.tsx`
- Modify: `app/company-intelligence.tsx`
- Modify: `app/vsee.css`
- Test: `tests/unit/ui-hardening.test.ts`
- Test: `tests/rendered-html.test.mjs`
- Create: `tests/unit/underwriting-view-model.test.ts`

**Interfaces:**
- Consumes the HTTP DTOs from Tasks 6, 7 and 14.
- Keeps existing `InternalReportDraft` dialog unchanged.

- [ ] **Step 1: Write failing UI/read-model tests**

Assert the navigation includes Fund Policy after Sources; public demo shows
upload/policy mutation disabled with explanation; product upload shows
queued/extracting/preview/confirmation/ready/failure states; identity must be
confirmed before promotion; `Apply Recommended Defaults` shows overwrite diff
and version; report displays Top 5 underwriting after Priority Result and before
the complete company list; `not_selected`, unavailable, partial, stale
benchmark and service failure look distinct; candidate detail exposes Evidence,
Context, Frameworks, Valuation, Decision, Sources and Versions; Action Draft
supports edit/copy/download but no To/Send/Publish.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
node --import tsx --test tests/unit/ui-hardening.test.ts \
  tests/unit/underwriting-view-model.test.ts
npm run test:legacy
```

Expected: FAIL because focused components and new view models do not exist.

- [ ] **Step 3: Implement focused components while preserving visual design**

Preserve sticky rail, top action bar, near-black panels, `--lime: #c7ff4a`,
serif display headings, mono labels, `.vsee-panel`, `.vsee-report`,
native dialog and existing 1040/980/680px breakpoints.

Add `policy` as the eighth `View`, fitting the existing 4×2 mobile rail.
Do not replace old report fallback or deep links. Do not embed new server
behavior in `page.tsx`; components call the typed API helper and receive safe DTOs.

The detailed report renders these fixed sections in order:

```text
1. What happened? — 14-day events, capital flow, date/source/confidence
2. What is the impact? — positive/negative mechanism, horizon, changed assumptions
3. Which historical companies are affected? — identity, status, prior context, match
4. Company underwriting — every applicable framework, support/counterevidence/unknowns
5. Valuation and fund return — Bear/Base/Bull, ask, ownership, dilution, MOIC, IRR
6. Final conclusion — Company Quality, Price Attractiveness, Fund Fit, decision trace
7. What can you do? — missing evidence, meeting/reference/DD/model/monitoring steps
8. Action drafts — editable/copy/download only
```

Every visible financial value displays its `Fact／Assumption／Calculation`
badge. Every formal claim opens its exact source revision or upstream
judgment/calculation chain. The Versions section shows pinned Policy,
Benchmark, Framework, Router, Critical Evidence, Valuation Method, Decision,
Formula, model/prompt/schema/settings and application commit.

- [ ] **Step 4: Verify GREEN, responsive render, and legacy draft**

Run:

```bash
node --import tsx --test tests/unit/ui-hardening.test.ts \
  tests/unit/underwriting-view-model.test.ts tests/unit/report-draft.test.ts
npm run test:legacy
npm run typecheck
npm run lint
```

Expected: tests and rendered HTML PASS; existing browser-local draft behavior remains.

- [ ] **Step 5: Commit**

```bash
git add app/fund-policy.tsx app/source-upload-flow.tsx \
  app/underwriting-summary.tsx app/underwriting-detail.tsx \
  app/action-draft-dialog.tsx app/page.tsx app/company-intelligence.tsx \
  app/vsee.css tests/unit/ui-hardening.test.ts \
  tests/unit/underwriting-view-model.test.ts tests/rendered-html.test.mjs
git commit -m "feat(ui): present auditable VC underwriting workflow"
```

---

### Task 16: Prove the complete vertical slice, security modes, and deployment contract

**Files:**
- Create: `tests/e2e/underwriting-vertical-slice.test.ts`
- Create: `tests/e2e/security-modes.test.ts`
- Create: `tests/e2e/upload-source-lineage.test.ts`
- Modify: `tests/integration/schema-migrations.test.ts`
- Modify: `README.md`
- Modify: `docs/demo-runbook.md`
- Modify: `.env.example`
- Modify: `Dockerfile.worker`
- Modify: `wrangler.jsonc`

**Interfaces:**
- No new product interface; this task verifies all prior contracts together.

- [ ] **Step 1: Write failing end-to-end scenarios**

Use fixed, source-grounded fixtures to exercise:

```text
manual trigger -> 14-day market scan -> XTrace recall -> historical matching
-> all eligible CompanyAnalysis -> Top-5 selection -> Evidence Pack -> Router
-> valuation -> core/specialist lenses -> disagreement -> deterministic decision
-> report -> Action Draft -> existing-data-only Chat
```

Include one complete `Invest Candidate`, one missing-critical-evidence
`Advance`, one good-company/overpriced result, one market-match/weak-company
result, XTrace partial failure, public-source partial failure, formula conflict,
Core-only unsupported sector, candidate partial failure, fingerprint reuse,
force refresh, upload confirmation/source link, and non-selected rank 6.

Security suite must iterate every workspace route and prove product no-session
401, cross-workspace 403/404, public-demo mutation 403, no private source leak,
no licensed framework body, and no send/publish side effect.

- [ ] **Step 2: Run the new E2E suites and verify RED**

Run:

```bash
node --import tsx --test tests/e2e
```

Expected: any remaining missing integration or deployment mismatch fails with a specific scenario name.

- [ ] **Step 3: Close only the integration gaps exposed by the failing tests**

Document exact Web and Worker environment variables, migration order
`0000..0010`, product/public-demo behavior, manual-run operation, source
privacy, XTrace/Claude separation, retry/replay semantics and unsupported
Slice-1 contexts. Ensure Web and Worker use identical schema/version constants.

Keep scheduled trigger, direct Email/SMS/LinkedIn delivery, Audio/PDF/DOCX
runtime ingestion, and future valuation slices disabled.

- [ ] **Step 4: Run full verification**

Run:

```bash
npm run typecheck
npm run lint
npm test
npm run test:legacy
npm run build
```

Expected:
- TypeScript, lint, build and rendered HTML PASS.
- All product assertions PASS.
- If the sandbox still reports the known two `listen EPERM 127.0.0.1` failures,
  re-run those route tests in an environment that permits localhost binding and
  record the external PASS before claiming completion.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e tests/integration/schema-migrations.test.ts README.md \
  docs/demo-runbook.md .env.example Dockerfile.worker wrangler.jsonc
git commit -m "test: verify source-grounded underwriting vertical slice"
```

---

## Plan Self-Review Checklist

- [x] Every requirement in Vertical Slice 1 maps to Tasks 1–16.
- [x] Runtime upload excludes audio/PDF/DOCX and does not write Deal/XTrace before confirmation.
- [x] Seeded and confirmed upload Deals converge on one eligible registry.
- [x] `not_selected` is a selection status, never a CandidateRun status or investment decision.
- [x] All legacy endpoints and `CompanyAnalysis.outcome` remain backward compatible.
- [x] All formal numbers originate from deterministic decimal-string formulas.
- [x] All formal decisions originate from versioned deterministic rules.
- [x] Every persisted claim has immutable source/item/rule dependencies.
- [x] Public demo and product mode have complete, tested route boundaries.
- [x] Drafts have no recipient/delivery/send/publish capability.
- [x] Future slices and automatic scheduling remain disabled.
- [x] No task contains an unresolved implementation value or changes the approved product rules.
