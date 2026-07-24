# 公司投資情報報告實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 將 14 天市場掃描改造成 Second Look 風格的投資情報流程，每次為固定 MVP corpus 中全部 19 筆 Deal 產生可持久保存、可追蹤來源的公司分析，並在完成後直接開啟 Priority Result 或完整 Report。

**Architecture:** 保留現有 Market、XTrace、Opus 與 Supabase 邊界，新增 `CompanyAnalysis` 資料契約、`company_analyses` 持久資料表及每筆 Deal 的 XTrace recall。Worker 先建立每間公司的證據包，再將有可信市場重疊的公司交給現有 evidence-constrained reasoner，最後為全部 19 間公司產生 `belief_revised`、`monitor`、`no_material_change` 或 `analysis_unavailable` 結果。前端改成 durable progress → Priority Result → Company Brief，不再把 Runs UUID 當成主要產出。

**Tech Stack:** TypeScript 5.9、Next.js 16／React 19、vinext／Cloudflare Sites、Zod 4、Drizzle ORM、PostgreSQL／Supabase REST、XTrace Memory API、Anthropic Claude Opus 4.8、Node test runner。

## Global Constraints

- 每次成功的 MVP 掃描必須保存固定 19 筆 CompanyAnalysis。
- 只有 `belief_revised` 且信心為 `medium` 或 `high` 的分析可以進入 Recommended second look。
- 沒有推薦結果時仍須產生完整 Report。
- 沒有來源支持的 ARR、收入、客戶、成長率、估值、融資條款、公司現況與風險不得顯示。
- 缺少欄位證據時固定顯示 `Not available in current evidence`。
- XTrace mode 不得在 recall 失敗時使用隱性 structured-memory fallback。
- 所有歷史投資脈絡必須保留 XTrace memory ID 與本機 source／fixture lineage。
- 所有公開市場 claim 必須保留 `public_web` source。
- Synthetic VC decision context 必須持續標示 `demo_fixture`。
- 模型只能產生研究、盡調與 follow-up 建議，不得建議投入或承諾資金。
- 單一公司分析失敗不得中止其他 18 筆分析。
- 現有 Report URL、舊 `opportunities`、Deals、Chat 與 Draft 必須向後相容。
- 所有程式修改使用 TDD；每一個任務獨立 commit。

---

## 檔案結構

### 新增檔案

- `drizzle/0004_company_analyses.sql`：新增 Report 摘要欄位、`company_analyses`、唯一鍵與原子保存 RPC。
- `lib/reports/company-analysis.ts`：建立 19 筆分析、outcome counts、Priority Result 與 sparse Company Brief。
- `worker/recall-deal-contexts.ts`：逐筆 Deal 執行有界 XTrace recall，隔離個別失敗。
- `app/api/reports/[id]/companies/[dealId]/route.ts`：單一 Company Brief API。
- `app/api/deals/[id]/analyses/route.ts`：公司歷次分析 API。
- `app/scan-progress.tsx`：Durable scan progress。
- `app/company-intelligence.tsx`：Priority Result、Report company list 與 Company Brief。
- `tests/unit/company-analysis.test.ts`：19 筆 outcome projection 與 sparse evidence 測試。
- `tests/unit/recall-deal-contexts.test.ts`：19 次 recall、邊界與錯誤隔離測試。
- `tests/integration/company-analyses-migration.test.ts`：migration、constraint 與原子 RPC 測試。
- `tests/integration/company-analyses-route.test.ts`：Report／Deal company-analysis API 測試。

### 修改檔案

- `lib/contracts/domain.ts`：CompanyAnalysis、CompanyBrief、Report summary Zod schemas。
- `lib/matching/service.ts`：保留低信心 grounded match，新增完整分析入口。
- `db/schema.ts`：Drizzle report 欄位與 `companyAnalyses` table。
- `db/repositories/intelligence.ts`：Report + analyses repository contract、Supabase RPC 與 legacy hydration。
- `worker/process-run.ts`：19-Deal recall、完整分析、報告保存與 partial status。
- `worker/runner.ts`：注入新的 recall adapter。
- `lib/reports/public.ts`：安全輸出完整 report。
- `lib/reports/draft.ts`：以 recommended CompanyAnalysis 產生草稿。
- `lib/chat/report-evidence.ts`：以持久化 CompanyAnalysis 建立 Chat evidence。
- `app/api/reports/route.ts`：支援 `runId` 查詢。
- `app/api/reports/[id]/route.ts`：回傳完整 report。
- `app/page.tsx`：掃描 polling、Priority Result navigation、Company Brief state、移除 Runs-first。
- `app/vsee.css`：Second Look 報告與 progress 樣式。
- `tests/contracts/domain.test.ts`、`tests/integration/process-run.test.ts`、`tests/unit/intelligence-repository.test.ts`、`tests/integration/reports-route.test.ts`、`tests/unit/report-draft.test.ts`、`tests/unit/report-chat-evidence.test.ts`、`tests/unit/ui-hardening.test.ts`：各邊界回歸測試。
- `drizzle/meta/_journal.json`：登記 migration 0004。

---

### Task 1：定義 CompanyAnalysis 與完整 Report 資料契約

**Files:**
- Modify: `lib/contracts/domain.ts`
- Modify: `tests/contracts/domain.test.ts`

**Interfaces:**
- Consumes: 現有 `DealStatusSchema`、`SourceRefSchema`、`MarketEventSchema`。
- Produces:
  - `CompanyAnalysisOutcomeSchema`
  - `CompanyAnalysisConfidenceSchema`
  - `EvidenceFieldSchema`
  - `InvestmentMemorySnapshotSchema`
  - `CompanyMarketEvidenceSchema`
  - `CompanyBriefSchema`
  - `CompanyAnalysisSchema`
  - `ReportAnalysisStatusSchema`
  - 對應 TypeScript types。

- [ ] **Step 1：先寫失敗的 contract tests**

在 `tests/contracts/domain.test.ts` 新增：

```ts
test("accepts a source-grounded no-change company analysis", () => {
  const parsed = CompanyAnalysisSchema.parse(companyAnalysisFixture({
    outcome: "no_material_change",
    confidence: "low",
    score: 0.21,
    recommendedNextMove: "No immediate follow-up recommended. Continue monitoring.",
  }));
  assert.equal(parsed.companyName, "7bridges");
  assert.equal(parsed.companyBrief.traction[0].value, null);
  assert.equal(
    parsed.companyBrief.traction[0].unavailableReason,
    "Not available in current evidence",
  );
});

test("rejects a displayed evidence value without source ids", () => {
  assert.throws(() => CompanyAnalysisSchema.parse(companyAnalysisFixture({
    companyBrief: {
      ...companyAnalysisFixture().companyBrief,
      traction: [{
        label: "ARR",
        value: "$2.4M",
        unavailableReason: null,
        sourceIds: [],
      }],
    },
  })));
});

test("rejects unavailable evidence fields that also contain a value", () => {
  assert.throws(() => EvidenceFieldSchema.parse({
    label: "ARR",
    value: "$2.4M",
    unavailableReason: "Not available in current evidence",
    sourceIds: ["source_1"],
  }));
});
```

- [ ] **Step 2：執行 contract tests，確認因 schema 尚不存在而失敗**

Run:

```bash
node --import tsx --test tests/contracts/domain.test.ts
```

Expected: FAIL，錯誤包含 `CompanyAnalysisSchema` 或 `EvidenceFieldSchema` 未匯出。

- [ ] **Step 3：實作最小且嚴格的 Zod schemas**

在 `lib/contracts/domain.ts` 新增：

```ts
export const CompanyAnalysisOutcomeSchema = z.enum([
  "belief_revised",
  "monitor",
  "no_material_change",
  "analysis_unavailable",
]);

export const CompanyAnalysisConfidenceSchema = z.enum(["low", "medium", "high"]);

export const EvidenceFieldSchema = z.object({
  label: z.string().min(1),
  value: z.string().min(1).nullable(),
  unavailableReason: z.literal("Not available in current evidence").nullable(),
  sourceIds: z.array(z.string().min(1)),
}).superRefine((field, context) => {
  const available = field.value !== null;
  if (available && (field.unavailableReason !== null || field.sourceIds.length === 0)) {
    context.addIssue({
      code: "custom",
      message: "Available evidence fields require source IDs and no unavailable reason",
    });
  }
  if (!available && (
    field.unavailableReason !== "Not available in current evidence"
    || field.sourceIds.length !== 0
  )) {
    context.addIssue({
      code: "custom",
      message: "Unavailable evidence fields require the fixed unavailable label",
    });
  }
});
```

定義下列固定形狀：

```ts
export const InvestmentMemorySnapshotSchema = z.object({
  previousMeetingSummary: z.string().min(1),
  decisionReason: z.string().min(1),
  concerns: z.array(z.string()),
  revisitConditions: z.array(z.string()),
  lastEvaluatedAt: z.string().datetime().nullable(),
  memoryIds: z.array(z.string()),
  sourceIds: z.array(z.string()),
  fixtureIds: z.array(z.string()),
});

export const CompanyMarketEvidenceSchema = z.object({
  relationship: z.enum(["satisfies", "contradicts", "related", "none", "unavailable"]),
  explanation: z.string().min(1),
  eventIds: z.array(z.string()),
  sourceIds: z.array(z.string()),
});

export const CompanyRiskSchema = z.object({
  severity: z.enum(["low", "medium", "high"]),
  title: z.string().min(1),
  detail: z.string().min(1),
  nextQuestion: z.string().min(1),
  sourceIds: z.array(z.string()).min(1),
});

export const CompanyBriefSchema = z.object({
  icSnapshot: z.array(EvidenceFieldSchema),
  traction: z.array(EvidenceFieldSchema),
  dealTerms: z.array(EvidenceFieldSchema),
  risks: z.array(CompanyRiskSchema),
  decisionHistory: z.array(z.object({
    occurredAt: z.string().datetime(),
    title: z.string().min(1),
    summary: z.string().min(1),
    sourceIds: z.array(z.string()).min(1),
  })),
  sourceLineage: z.array(SourceRefSchema),
});
```

`CompanyAnalysisSchema` 必須包含 Spec 所列 identity、investment memory、market evidence、implications、next move、brief、sources 與 `createdAt`。加入 `superRefine`：

- `belief_revised` 僅允許 `medium`／`high`；
- `no_material_change` 固定為 `low`；
- 除 `analysis_unavailable` 外至少一筆 source；
- `marketEvidence.sourceIds` 必須存在於 `sources`。

- [ ] **Step 4：重跑 contract tests**

Run:

```bash
node --import tsx --test tests/contracts/domain.test.ts
```

Expected: PASS。

- [ ] **Step 5：執行 typecheck 並提交**

```bash
npm run typecheck
git add lib/contracts/domain.ts tests/contracts/domain.test.ts
git commit -m "feat: define company analysis contracts"
```

---

### Task 2：新增 PostgreSQL schema、migration 與原子保存 RPC

**Files:**
- Create: `drizzle/0004_company_analyses.sql`
- Create: `tests/integration/company-analyses-migration.test.ts`
- Modify: `db/schema.ts`
- Modify: `drizzle/meta/_journal.json`
- Modify: `tests/integration/schema-migrations.test.ts`

**Interfaces:**
- Consumes: Task 1 的 JSON contract 欄位名稱。
- Produces:
  - `company_analyses` table
  - `save_intelligence_report(p_report jsonb, p_analyses jsonb)` PostgreSQL function
  - `companyAnalyses` Drizzle table export。

- [ ] **Step 1：先寫 migration 失敗測試**

測試建立暫時 PostgreSQL database、依序執行 `0000` 到 `0004`，再驗證：

```ts
assert.deepEqual(
  await columns("company_analyses"),
  [
    "id", "workspace_id", "report_id", "run_id", "deal_id",
    "company_name", "deal_status", "outcome", "confidence", "score",
    "investment_memory", "market_evidence", "implications",
    "recommended_next_move", "company_brief", "source_refs", "created_at",
  ],
);
```

測試插入兩筆相同 `(report_id, deal_id)` 時得到 unique violation。測試呼叫：

```sql
select save_intelligence_report(
  '{"id":"report_test", ...}'::jsonb,
  '[{"id":"analysis_test", ...}]'::jsonb
);
```

並驗證 Report 與 analysis 同時存在。

- [ ] **Step 2：執行 migration test，確認 0004 尚不存在**

Run:

```bash
node --import tsx --test tests/integration/company-analyses-migration.test.ts
```

Expected: FAIL，錯誤為 migration file 或 table 不存在。

- [ ] **Step 3：建立 migration**

`drizzle/0004_company_analyses.sql` 必須：

```sql
alter table public.intelligence_reports
  add column if not exists analysis_status text not null default 'completed',
  add column if not exists company_count integer not null default 0,
  add column if not exists belief_revised_count integer not null default 0,
  add column if not exists monitor_count integer not null default 0,
  add column if not exists no_material_change_count integer not null default 0,
  add column if not exists analysis_unavailable_count integer not null default 0,
  add column if not exists priority_deal_id text,
  add column if not exists evidence_coverage jsonb not null default '{}'::jsonb;

create table if not exists public.company_analyses (
  id text primary key,
  workspace_id text not null,
  report_id text not null references public.intelligence_reports(id) on delete cascade,
  run_id uuid not null references public.scan_runs(id) on delete cascade,
  deal_id text not null references public.deals(id),
  company_name text not null,
  deal_status text not null,
  outcome text not null check (
    outcome in ('belief_revised','monitor','no_material_change','analysis_unavailable')
  ),
  confidence text not null check (confidence in ('low','medium','high')),
  score double precision not null check (score >= 0 and score <= 1),
  investment_memory jsonb not null,
  market_evidence jsonb not null,
  implications jsonb not null,
  recommended_next_move text not null,
  company_brief jsonb not null,
  source_refs jsonb not null,
  created_at timestamptz not null default now(),
  unique (report_id, deal_id)
);
```

RPC 必須在單一 transaction 中 upsert Report、刪除該 Report 舊 analyses、插入新 analyses，最後回傳完整 Report row。函式不得使用 elevated `security definer`。

- [ ] **Step 4：更新 Drizzle schema 與 journal**

在 `db/schema.ts` 使用 `doublePrecision`、`jsonb` 與現有 references 定義相同欄位。`drizzle/meta/_journal.json` 新增 index 4、tag `0004_company_analyses`。

- [ ] **Step 5：執行 migration tests**

```bash
node --import tsx --test \
  tests/integration/company-analyses-migration.test.ts \
  tests/integration/schema-migrations.test.ts
```

Expected: PASS。

- [ ] **Step 6：提交**

```bash
git add drizzle/0004_company_analyses.sql drizzle/meta/_journal.json \
  db/schema.ts tests/integration/company-analyses-migration.test.ts \
  tests/integration/schema-migrations.test.ts
git commit -m "feat: persist company intelligence analyses"
```

---

### Task 3：擴充 IntelligenceRepository 並保持舊 Report 相容

**Files:**
- Modify: `db/repositories/intelligence.ts`
- Modify: `tests/unit/intelligence-repository.test.ts`

**Interfaces:**
- Consumes: Task 1 `CompanyAnalysis` type、Task 2 RPC。
- Produces:

```ts
export interface IntelligenceReportRecord {
  id: string;
  workspaceId: string;
  runId: string;
  createdAt: string;
  marketSummary: string;
  analysisStatus: "completed" | "incomplete";
  evidenceCoverage: EvidenceCoverage;
  counts: CompanyAnalysisCounts;
  priorityDealId: string | null;
  opportunities: OpportunityReportItem[];
  companyAnalyses: CompanyAnalysis[];
}
```

Repository 新增：

```ts
getReportByRunId(runId: string): Promise<IntelligenceReportRecord | null>;
listDealAnalyses(
  workspaceId: string,
  dealId: string,
): Promise<CompanyAnalysis[]>;
```

- [ ] **Step 1：先寫 repository 失敗測試**

新增測試：

```ts
test("stores one report with exactly nineteen ordered company analyses", async () => {
  const repository = createMemoryIntelligenceRepository();
  const report = reportFixture({ companyAnalyses: nineteenAnalyses() });
  await repository.saveReport(report);

  const stored = await repository.getReport(report.id);
  assert.equal(stored?.companyAnalyses.length, 19);
  assert.equal(stored?.counts.noMaterialChange, 19);
  assert.equal(
    (await repository.getReportByRunId(report.runId))?.id,
    report.id,
  );
});

test("hydrates a legacy report with opportunities and no company rows", async () => {
  const legacy = await legacySupabaseReportFixture();
  assert.equal(legacy.companyAnalyses.length, 1);
  assert.equal(legacy.companyAnalyses[0].outcome, "belief_revised");
});
```

Supabase seam 測試需確認保存時呼叫 `/rest/v1/rpc/save_intelligence_report`，body 包含 `p_report` 與 19 筆 `p_analyses`，不把 service-role key 暴露至回傳值。

- [ ] **Step 2：執行 repository tests，確認新 interface 尚未存在**

```bash
node --import tsx --test tests/unit/intelligence-repository.test.ts
```

Expected: FAIL。

- [ ] **Step 3：實作 memory repository**

使用：

```ts
const reports = new Map<string, IntelligenceReportRecord>();
const analysesByReport = new Map<string, CompanyAnalysis[]>();
```

`saveReport` 先以 `CompanyAnalysisSchema.array().length(19)` 驗證新版報告，再一次 clone 保存。舊版測試 fixture 允許零筆分析。

- [ ] **Step 4：實作 Supabase repository**

- `saveReport` 呼叫 `/rpc/save_intelligence_report`。
- `getReport` 與 `listReports` 取得 Report rows 後，使用一次 `company_analyses?report_id=in.(...)` 批次讀取，避免 N+1。
- `getReportByRunId` 使用 `run_id=eq.<uuid>&limit=1`。
- `listDealAnalyses` 使用 `workspace_id`、`deal_id` 與 `created_at.desc`。
- 所有 JSON 欄位在 repository egress 通過 Task 1 schemas。
- 格式錯誤的舊資料不得穿過 public boundary；legacy opportunities 使用既有 sanitizer 建立相容 projection。

- [ ] **Step 5：重跑 repository tests**

```bash
node --import tsx --test tests/unit/intelligence-repository.test.ts
npm run typecheck
```

Expected: PASS。

- [ ] **Step 6：提交**

```bash
git add db/repositories/intelligence.ts tests/unit/intelligence-repository.test.ts
git commit -m "feat: store complete company analysis reports"
```

---

### Task 4：逐筆 Deal 執行 XTrace recall 並隔離失敗

**Files:**
- Create: `worker/recall-deal-contexts.ts`
- Create: `tests/unit/recall-deal-contexts.test.ts`
- Modify: `worker/runner.ts`

**Interfaces:**
- Consumes:

```ts
type DealRecallService = Pick<
  ReturnType<typeof createXTraceService>,
  "recallDealContext"
>;
```

- Produces:

```ts
export interface DealRecallResult {
  contextsByDeal: Map<string, MemoryContext[]>;
  failures: Array<{ dealId: string; message: string }>;
}

export async function recallAllDealContexts(input: {
  workspaceId: string;
  runId: string;
  bundles: DealMemoryBundle[];
  service?: DealRecallService;
}): Promise<DealRecallResult>;
```

- [ ] **Step 1：寫 19 次 recall 的失敗測試**

```ts
test("recalls one bounded XTrace query for every MVP Deal", async () => {
  const queries: Array<{ query: string; candidateDealIds: string[] }> = [];
  const result = await recallAllDealContexts({
    workspaceId: "workspace_demo",
    runId: "run_1",
    bundles: buildPreloadedDealMemoryBundles(),
    service: {
      async recallDealContext(input) {
        queries.push(input);
        return [memoryFor(input.candidateDealIds[0])];
      },
    },
  });
  assert.equal(queries.length, 19);
  assert.ok(queries.every((query) => query.query.length <= 4_000));
  assert.ok(queries.every((query) => query.candidateDealIds.length === 1));
  assert.equal(result.contextsByDeal.size, 19);
});

test("one failed recall does not suppress the other eighteen Deals", async () => {
  // deal_7bridges throws; every other Deal returns memory.
  assert.equal(result.failures.length, 1);
  assert.equal(result.contextsByDeal.size, 18);
});
```

- [ ] **Step 2：執行測試，確認 module 不存在**

```bash
node --import tsx --test tests/unit/recall-deal-contexts.test.ts
```

Expected: FAIL。

- [ ] **Step 3：實作 bounded company query**

每筆 query 使用：

```ts
function dealRecallQuery(bundle: DealMemoryBundle): string {
  return [
    bundle.companyName,
    "investment decision",
    "meeting summary",
    "decision reason",
    "partner concerns",
    "revisit conditions",
  ].join(" · ").slice(0, 4_000);
}
```

逐筆 `await` recall，讓現有 distributed limiter 控制速率。每筆 request：

```ts
{
  workspaceId,
  runId: `${runId}:${bundle.dealId}`,
  query: dealRecallQuery(bundle),
  candidateDealIds: [bundle.dealId],
  limit: 20,
}
```

捕捉單筆錯誤，使用 800 字元 sanitization 保存 message，不記錄 credential 或完整 provider response。

- [ ] **Step 4：重跑測試**

```bash
node --import tsx --test tests/unit/recall-deal-contexts.test.ts
```

Expected: PASS。

- [ ] **Step 5：在 runner 注入 XTrace service，不改變 credential 邊界**

`worker/runner.ts` 持續只在 server 端建立一次 `createXTraceService`，並將相同 service 傳給 `processClaimedRun`。不得將 API key 放入 dependency object 或 log。

- [ ] **Step 6：提交**

```bash
git add worker/recall-deal-contexts.ts tests/unit/recall-deal-contexts.test.ts \
  worker/runner.ts
git commit -m "feat: recall XTrace context for every deal"
```

---

### Task 5：保留低信心 grounded match 並建立全部 19 筆分析

**Files:**
- Modify: `lib/matching/service.ts`
- Modify: `lib/matching/scoring.ts`
- Create: `lib/reports/company-analysis.ts`
- Create: `tests/unit/company-analysis.test.ts`
- Modify: `tests/unit/matching.test.ts`

**Interfaces:**
- Consumes: Task 1 contracts、現有 `MatchingInput`、`ReasonedMatch`、`DealMemoryBundle`。
- Produces:

```ts
export interface GroundedMatch {
  dealId: string;
  confidence: "low" | "medium" | "high";
  score: number;
  whyNow: string;
  previousContext: string;
  implications: { positive: string[]; negative: string[] };
  nextStep: string;
  sources: SourceRef[];
  demoFixtureIds: string[];
}

createMatchingService(reasoner).analyze(
  input: MatchingInput,
): Promise<GroundedMatch[]>;

export function buildCompanyAnalyses(input: {
  reportId: string;
  runId: string;
  createdAt: string;
  bundles: DealMemoryBundle[];
  contextsByDeal: ReadonlyMap<string, MemoryContext[]>;
  recallFailures: ReadonlySet<string>;
  groundedMatches: GroundedMatch[];
}): CompanyAnalysis[];
```

- [ ] **Step 1：先寫完整 19 筆 projection 測試**

```ts
test("builds one analysis for every fixed MVP Deal", () => {
  const analyses = buildCompanyAnalyses({
    reportId: "report_1",
    runId: "run_1",
    createdAt: "2026-07-24T12:00:00.000Z",
    bundles: buildPreloadedDealMemoryBundles(),
    contextsByDeal: contextsForEveryDeal(),
    recallFailures: new Set(),
    groundedMatches: [],
  });
  assert.equal(analyses.length, 19);
  assert.ok(analyses.every((analysis) =>
    analysis.outcome === "no_material_change"
  ));
});

test("projects qualified and low grounded matches without inventing fields", () => {
  const analyses = buildCompanyAnalyses({
    ...baseInput(),
    groundedMatches: [
      groundedMatch("deal_ably", "high"),
      groundedMatch("deal_100plus", "low"),
    ],
  });
  assert.equal(byDeal(analyses, "deal_ably").outcome, "belief_revised");
  assert.equal(byDeal(analyses, "deal_100plus").outcome, "monitor");
  assert.equal(
    byDeal(analyses, "deal_ably").companyBrief.traction[0].value,
    null,
  );
});

test("uses analysis unavailable only for the failed company recall", () => {
  const analyses = buildCompanyAnalyses({
    ...baseInput(),
    recallFailures: new Set(["deal_7bridges"]),
  });
  assert.equal(byDeal(analyses, "deal_7bridges").outcome, "analysis_unavailable");
  assert.equal(
    analyses.filter((analysis) => analysis.outcome === "analysis_unavailable").length,
    1,
  );
});
```

- [ ] **Step 2：執行測試，確認 builder 尚不存在**

```bash
node --import tsx --test \
  tests/unit/company-analysis.test.ts \
  tests/unit/matching.test.ts
```

Expected: FAIL。

- [ ] **Step 3：將 matching 分成 analyze 與 match projection**

將目前 `createMatchingService().match()` 的 grounding 流程抽成 `analyze()`：

- 保留所有通過 deterministic overlap 與 claim grounding 的結果；
- 使用 `confidenceForScore` 標示 low／medium／high；
- 不在 `analyze()` 中 slice Top 5；
- `match()` 保持既有 public 行為，只投影 medium／high、排序並 slice 5。

現有 matching safety tests 必須不變。

- [ ] **Step 4：實作 CompanyAnalysis builder**

對每個 `bundle`：

1. recall failure → `analysis_unavailable`；
2. 有 medium/high grounded match → `belief_revised`；
3. 有 low grounded match → `monitor`；
4. 沒有 grounded match → `no_material_change`。

Investment Memory 從 bundle interaction 與 XTrace context 組合：

```ts
{
  previousMeetingSummary: interaction.summary,
  decisionReason: interaction.decisionReason,
  concerns: interaction.concerns,
  revisitConditions: interaction.revisitConditions,
  lastEvaluatedAt: interaction.occurredAt,
  memoryIds: contexts.map((context) => context.memoryId),
  sourceIds: unique(bundle.facts.flatMap((fact) =>
    fact.sources.map((source) => source.id)
  )),
  fixtureIds: [interaction.id],
}
```

Sparse Company Brief：

- IC Snapshot 使用 source-backed company fact、decision reason 與 matching result。
- Traction 固定建立 ARR、Customers、Growth 三個 `EvidenceField`；缺少結構化證據時全為 unavailable。
- Deal Terms 固定建立 Round、Raise、Valuation 三個 unavailable fields，除非 exact source excerpt 支持。
- Risks 使用 fixture concerns，sourceIds 指向 fixture ID，並保持 `demo_fixture` 標示。
- Decision History 使用 interaction。
- Source Lineage 合併 Deal facts、matched public sources 與 synthetic fixture source refs。

- [ ] **Step 5：執行 tests 與 typecheck**

```bash
node --import tsx --test \
  tests/unit/company-analysis.test.ts \
  tests/unit/matching.test.ts \
  tests/unit/matching-reasoner.test.ts
npm run typecheck
```

Expected: PASS。

- [ ] **Step 6：提交**

```bash
git add lib/matching/service.ts lib/matching/scoring.ts \
  lib/reports/company-analysis.ts tests/unit/company-analysis.test.ts \
  tests/unit/matching.test.ts
git commit -m "feat: analyze every deal after market scans"
```

---

### Task 6：將完整分析接入 Worker 與報告保存

**Files:**
- Modify: `worker/process-run.ts`
- Modify: `tests/integration/process-run.test.ts`

**Interfaces:**
- Consumes:
  - Task 3 `IntelligenceRepository.saveReport`
  - Task 4 `recallAllDealContexts`
  - Task 5 `createMatchingService().analyze` 與 `buildCompanyAnalyses`
- Produces: 每次 terminal report 有 19 筆 analyses、counts 與 priority Deal。

- [ ] **Step 1：先寫 Worker 失敗測試**

新增：

```ts
test("a successful scan persists nineteen company analyses and no-change report", async () => {
  const result = await processClaimedRun(run, dependenciesWith({
    groundedMatches: [],
    contextsByDeal: contextsForEveryDeal(),
  }));
  assert.equal(result.run.status, "completed");
  assert.equal(result.report.companyAnalyses.length, 19);
  assert.equal(result.report.counts.noMaterialChange, 19);
  assert.equal(result.report.priorityDealId, null);
});

test("a single recall failure produces one unavailable analysis and a partial report", async () => {
  // 18 contexts succeed; deal_7bridges fails.
  assert.equal(result.run.status, "partial");
  assert.equal(result.report.companyAnalyses.length, 19);
  assert.equal(result.report.counts.analysisUnavailable, 1);
});

test("selects the highest qualified belief revision as priority", async () => {
  assert.equal(result.report.priorityDealId, "deal_ably");
  assert.deepEqual(
    result.report.opportunities.map((item) => item.dealId),
    ["deal_ably"],
  );
});
```

- [ ] **Step 2：執行 process-run tests，確認仍只保存 opportunities**

```bash
node --import tsx --test tests/integration/process-run.test.ts
```

Expected: FAIL。

- [ ] **Step 3：替換單次全域 recall**

保留 `memory_ingest_sync` stage，將 `memory_recall` 改為呼叫 `recallAllDealContexts`。Stage warning 必須列出失敗 Deal 數量及經過清理的原因，不顯示 API credential。

- [ ] **Step 4：建立 19 筆 analyses 與 Report counts**

流程：

```ts
const groundedMatches = await matching.analyze(matchingInput);
const companyAnalyses = buildCompanyAnalyses({ ... });
const recommended = companyAnalyses
  .filter((analysis) =>
    analysis.outcome === "belief_revised"
    && analysis.confidence !== "low"
  )
  .sort((left, right) => right.score - left.score)
  .slice(0, 5);
```

Legacy opportunities 從 `recommended` 投影，不重新呼叫模型。Report counts 使用純函式由 19 筆結果計算。

- [ ] **Step 5：調整 Run status**

- market provider failure或任何 `analysis_unavailable` → partial；
- 正常輸入篩選與 0 recommendation → completed；
- report persistence failure → failed。

- [ ] **Step 6：重跑 Worker tests**

```bash
node --import tsx --test tests/integration/process-run.test.ts
npm run typecheck
```

Expected: PASS。

- [ ] **Step 7：提交**

```bash
git add worker/process-run.ts tests/integration/process-run.test.ts
git commit -m "feat: generate complete scan reports"
```

---

### Task 7：公開 Report／Company APIs，並遷移 Chat 與 Draft

**Files:**
- Modify: `lib/reports/public.ts`
- Modify: `app/api/reports/route.ts`
- Modify: `app/api/reports/[id]/route.ts`
- Create: `app/api/reports/[id]/companies/[dealId]/route.ts`
- Create: `app/api/deals/[id]/analyses/route.ts`
- Create: `tests/integration/company-analyses-route.test.ts`
- Modify: `tests/integration/reports-route.test.ts`
- Modify: `lib/reports/draft.ts`
- Modify: `tests/unit/report-draft.test.ts`
- Modify: `lib/chat/report-evidence.ts`
- Modify: `tests/unit/report-chat-evidence.test.ts`

**Interfaces:**
- Consumes: Task 3 repository 與 Task 1 schemas。
- Produces:
  - `GET /api/reports?runId=<uuid>`
  - `GET /api/reports/:id`
  - `GET /api/reports/:id/companies/:dealId`
  - `GET /api/deals/:id/analyses`
  - CompanyAnalysis-backed Draft 與 Chat evidence。

- [ ] **Step 1：先寫 API 失敗測試**

驗證：

```ts
assert.equal(reportResponse.data.companyAnalyses.length, 19);
assert.equal(
  runReportResponse.data.runId,
  "00000000-0000-4000-8000-000000000001",
);
assert.equal(companyResponse.data.dealId, "deal_7bridges");
assert.ok(Array.isArray(historyResponse.data));
assert.equal(
  "workerId" in reportResponse.data,
  false,
);
```

驗證格式錯誤的 stored CompanyAnalysis 被 serializer 拒絕或標準化為 `analysis_unavailable`，不得原樣送到前端。

- [ ] **Step 2：執行 route tests，確認 endpoint／欄位尚不存在**

```bash
node --import tsx --test \
  tests/integration/company-analyses-route.test.ts \
  tests/integration/reports-route.test.ts
```

Expected: FAIL。

- [ ] **Step 3：實作 public serializers 與 routes**

- `toPublicReport` 輸出 Report contract、counts、priority Deal 與安全的 CompanyAnalysis。
- `/api/reports?runId=` 使用 repository `getReportByRunId`，無結果時回空陣列，不洩漏其他 workspace。
- Company route 僅從指定 Report 的已持久分析取值。
- Deal history route 限定 `workspace_demo`。

- [ ] **Step 4：先寫 Draft／Chat 失敗測試**

Draft 測試驗證只包含 `belief_revised` medium/high 分析，並包含 Then、Now、remaining risks 與 sources。Chat 測試驗證可回答：

- 最新分析中 7bridges 的 outcome；
- decision reason；
- 本次是否有 material market evidence；
- recommended next move。

- [ ] **Step 5：遷移 Draft 與 Chat**

`buildInternalReportDraft` 優先使用 `companyAnalyses`；舊 Report 缺少 analyses 時仍使用 opportunities。Draft 不增加 recipient 或寄信功能。

`buildPersistedReportEvidence` 為每個 CompanyAnalysis 建立 model-inference conclusion evidence，並另外加入其 resolved `sourceRefs`。不得將 `analysis_unavailable` 當成公司事實。

- [ ] **Step 6：執行 tests**

```bash
node --import tsx --test \
  tests/integration/company-analyses-route.test.ts \
  tests/integration/reports-route.test.ts \
  tests/unit/report-draft.test.ts \
  tests/unit/report-chat-evidence.test.ts \
  tests/integration/chat-route.test.ts
npm run typecheck
```

Expected: PASS。

- [ ] **Step 7：提交**

```bash
git add lib/reports/public.ts app/api/reports/route.ts \
  app/api/reports/'[id]'/route.ts \
  app/api/reports/'[id]'/companies/'[dealId]'/route.ts \
  app/api/deals/'[id]'/analyses/route.ts \
  tests/integration/company-analyses-route.test.ts \
  tests/integration/reports-route.test.ts lib/reports/draft.ts \
  tests/unit/report-draft.test.ts lib/chat/report-evidence.ts \
  tests/unit/report-chat-evidence.test.ts
git commit -m "feat: expose company intelligence reports"
```

---

### Task 8：建立 durable Scan Progress 與完成後自動導向

**Files:**
- Create: `app/scan-progress.tsx`
- Modify: `app/page.tsx`
- Modify: `tests/unit/ui-hardening.test.ts`

**Interfaces:**
- Consumes:
  - `POST /api/runs`
  - `GET /api/runs/:id`
  - `GET /api/reports?runId=:id`
- Produces:
  - `ScanProgress` component
  - `activeRunId`
  - terminal Run → latest Report navigation。

- [ ] **Step 1：先寫 UI 靜態與流程測試**

測試 source 必須包含：

```ts
assert.match(pageSource, /WAKE AGENT & SCAN MARKET/);
assert.match(pageSource, /setActiveRunId/);
assert.match(pageSource, /api\\/reports\\?runId=/);
assert.doesNotMatch(runScanBody, /navigate\\(\"runs\"\\)/);
```

`ScanProgress` 測試五個階段文案與 terminal failure message。

- [ ] **Step 2：執行 UI tests，確認仍是 Runs-first**

```bash
node --import tsx --test tests/unit/ui-hardening.test.ts
```

Expected: FAIL。

- [ ] **Step 3：實作 ScanProgress component**

Props：

```ts
interface ScanProgressProps {
  run: Run;
  onClose(): void;
}
```

將 durable `currentStage` 對應：

- `market_scan` → `Scanning the last 14 days of public evidence`
- `memory_ingest_sync`／`memory_recall` → `Recalling XTrace investment memory`
- `opportunity_matching` → `Comparing evidence across 19 companies`
- `report` → `Generating company intelligence report`
- `notification`／completed → `Report ready`

- [ ] **Step 4：修改 runScan 與 polling**

`runScan()` 成功後：

```ts
setActiveRunId(run.id);
setActiveRun(run);
setScanProgressOpen(true);
```

不得 `navigate("runs")`。

使用 React effect 每 2 秒輪詢 active Run。Terminal status 時停止 timer：

- completed／partial → `GET /api/reports?runId=...`；
- 將 Report upsert 到 state；
- 有 `priorityDealId` 時開啟 Priority Result；
- 否則 navigate reports 並 focus Report；
- failed 時保留 progress error，不建立假 Report。

Effect cleanup 必須 `clearTimeout` 並避免 unmounted state update。

- [ ] **Step 5：執行 UI tests 與 typecheck**

```bash
node --import tsx --test tests/unit/ui-hardening.test.ts
npm run typecheck
```

Expected: PASS。

- [ ] **Step 6：提交**

```bash
git add app/scan-progress.tsx app/page.tsx tests/unit/ui-hardening.test.ts
git commit -m "feat: open reports after durable scans"
```

---

### Task 9：實作 Priority Result、19 間公司列表與 Company Brief

**Files:**
- Create: `app/company-intelligence.tsx`
- Modify: `app/page.tsx`
- Modify: `app/vsee.css`
- Modify: `tests/unit/ui-hardening.test.ts`
- Modify: `tests/rendered-html.test.mjs`

**Interfaces:**
- Consumes: Task 7 public Report／CompanyAnalysis contract。
- Produces:
  - `PriorityResult`
  - `CompanyAnalysisList`
  - `CompanyBrief`
  - `SystemActivity` secondary view。

- [ ] **Step 1：先寫 UI 結構失敗測試**

驗證 source／rendered HTML 包含：

```ts
for (const label of [
  "THEN / INVESTMENT MEMORY",
  "NOW / MARKET EVIDENCE",
  "RECOMMENDED NEXT MOVE",
  "IC Snapshot",
  "Traction",
  "Deal Terms",
  "Risks",
  "Decision History",
  "Source Lineage",
  "Not available in current evidence",
]) {
  assert.match(rendered, new RegExp(escapeRegExp(label)));
}
```

驗證 Runs 不再出現在 primary navigation，Settings 中有 `System activity`。

- [ ] **Step 2：執行 UI tests，確認元件尚不存在**

```bash
node --import tsx --test \
  tests/unit/ui-hardening.test.ts \
  tests/rendered-html.test.mjs
```

Expected: FAIL。

- [ ] **Step 3：建立 PriorityResult**

顯示順序固定為：

1. 公司名稱、Deal status、outcome、confidence；
2. Then：meeting summary、decision reason、concerns、revisit conditions；
3. `BELIEF REVISED`／`MONITOR`／`NO MATERIAL CHANGE`／`ANALYSIS UNAVAILABLE`；
4. Now：market evidence explanation、event sources；
5. Recommended next move；
6. `Inspect evidence`、`Draft internal report`、`Open full company brief`。

不得在 `analysis_unavailable` 顯示 recommendation。

- [ ] **Step 4：建立 Reports company list**

每份 Report header 顯示：

- 19 companies analyzed；
- outcome counts；
- evidence coverage；
- filters：All、Belief revised、Monitor、No material change、Unavailable；
- Deal status 與 confidence filters；
- 排序：belief revised high → belief revised medium → monitor → no change → unavailable。

每一列顯示公司名稱，不顯示 Deal UUID 作為主要標題。

- [ ] **Step 5：建立 CompanyBrief tabs**

Tabs 使用持久化 `companyBrief`，不在 render 時重新推理。EvidenceField value 為 null 時顯示固定 unavailable label。SourceLineage 使用現有 `SourceLink`，保留文件頁碼與 public URL。

- [ ] **Step 6：將 Runs 移至 Settings**

移除 primary nav 的 `Runs`。Settings 加入 `System activity` accordion／section，重用既有 run list，UUID 僅在此顯示。

- [ ] **Step 7：加入 responsive styles**

`app/vsee.css`：

- Priority Result desktop 為 Then／relationship／Now 三欄；
- 低於 900px 改為單欄；
- tabs 可水平捲動；
- 19-company list 保留 keyboard focus；
- modal／drawer 使用單一 `<main>` landmark；
- confidence、outcome 不只用顏色表達。

- [ ] **Step 8：執行 UI tests、typecheck、lint、build**

```bash
node --import tsx --test \
  tests/unit/ui-hardening.test.ts \
  tests/rendered-html.test.mjs
npm run typecheck
npm run lint
npm run build
```

Expected: 全部 PASS。

- [ ] **Step 9：提交**

```bash
git add app/company-intelligence.tsx app/page.tsx app/vsee.css \
  tests/unit/ui-hardening.test.ts tests/rendered-html.test.mjs
git commit -m "feat: add second-look company report experience"
```

---

### Task 10：完整回歸、Supabase migration、真實掃描與正式部署

**Files:**
- Modify when verification exposes a defect: only the failing component and its test.
- Update: `README.md` or deployment runbook only if the new migration／scan flow changes operator steps.

**Interfaces:**
- Consumes: Tasks 1–9 的完整功能。
- Produces: 已遷移 Supabase、19-result real report、GitHub main、Sites production version。

- [ ] **Step 1：執行完整本機測試，不連正式 Supabase**

```bash
unset SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY
npm test
npm run typecheck
npm run lint
npm run build
```

Expected: 0 failures。Live XTrace test 可在此步跳過。

- [ ] **Step 2：執行 live XTrace bridge**

從 macOS Keychain 只注入 XTrace credential：

```bash
export XTRACE_API_KEY="$(security find-generic-password -a "$USER" -s "vsee-xtrace-api-key" -w)"
export XTRACE_API_BASE_URL="https://api.production.xtrace.ai"
export XTRACE_LIVE_TEST=1
node --import tsx --test tests/integration/xtrace-live.test.ts
```

Expected: PASS，cleanup 成功。不得輸出 key。

- [ ] **Step 3：將 migration 套用至 Supabase**

複製 `drizzle/0004_company_analyses.sql` 至 Supabase SQL Editor 執行。警告屬正常 schema migration；執行前確認 target project，執行後驗證：

```sql
select count(*) from public.company_analyses;
select routine_name
from information_schema.routines
where routine_name = 'save_intelligence_report';
```

Expected: table 可查詢且 function 存在。

- [ ] **Step 4：重啟本機 Worker 與 Web，檢查 health**

從 Keychain 注入 Supabase、XTrace、Anthropic、document signing secret。啟動 Worker 與 Web。檢查：

```bash
curl -sS http://localhost:3000/api/settings/health
```

Expected: postgres、worker、xtrace、anthropic、storage、corpusReady 全為 true，marketProviders 為 8。

- [ ] **Step 5：執行真實 14 天 XTrace scan**

```bash
curl -sS -X POST http://localhost:3000/api/runs \
  -H 'content-type: application/json' \
  --data '{"xtraceEnabled":true}'
```

輪詢 Run 至 terminal，再以 `GET /api/reports?runId=<id>` 驗證：

- `companyAnalyses.length === 19`
- counts 總和為 19
- 每筆有 company name、investment memory、outcome、brief 與 sources
- 沒有 unsupported metrics
- 0 recommendations 時仍為 completed report
- 個別 recall／provider failure 時 truthfully partial。

- [ ] **Step 6：用瀏覽器驗證完整產品流程**

從 Overview 啟動掃描，確認：

- 不會跳到 Runs；
- 顯示 durable progress；
- terminal 後自動開 Report；
- 有 priority 時顯示 Then／Now／Next Move；
- Report 顯示 19 間公司；
- Company Brief 六個 tabs 正常；
- Source links 可開啟正確 public URL 或私有文件頁碼；
- Settings → System activity 可查看 Run diagnostics。

- [ ] **Step 7：最後完整驗證並提交修正**

若真實掃描暴露問題，先為該問題新增 failing test，再做最小修正。最後重新執行：

```bash
npm test
npm run typecheck
npm run lint
npm run build
git status --short
```

Expected: 0 failures，僅存在預期修改。

- [ ] **Step 8：推送 GitHub main**

```bash
git push origin main
git rev-parse HEAD
git ls-remote origin refs/heads/main
```

Expected: 本機 HEAD 與 GitHub main SHA 完全相同。

- [ ] **Step 9：部署現有 Sites 專案**

讀取 `.openai/hosting.json` 並沿用既有 `project_id`。將精確 HEAD 推到 Sites source repository，從同一 commit 建立 deployable archive，保存新 Site version，再部署該 version。不得建立第二個 Site。

- [ ] **Step 10：驗證 Production**

驗證：

```bash
curl -sS https://vsee-vc-intelligence.dream86625.chatgpt.site/api/settings/health
curl -sS https://vsee-vc-intelligence.dream86625.chatgpt.site/api/reports
```

Expected:

- production health 全部 true；
- latest Report 有 19 筆 analyses；
- UI 可完成 progress → Report → Company Brief；
- 部署 version 的 commit SHA 等於已驗證 GitHub main SHA。

- [ ] **Step 11：完成提交**

若 Task 10 產生 runbook 或驗證修正：

```bash
git add <only-the-verified-files>
git commit -m "docs: document company intelligence deployment"
git push origin main
```

若沒有檔案變更，不建立空 commit。
