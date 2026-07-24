# XTrace VC Deal Intelligence Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the existing hardcoded VC frontend into a persistent public demo that ingests the fixed PDF corpus, uses XTrace for Deal memory, scans the latest 14 days of public information, ranks cited opportunities with Claude, and sends real email.

**Architecture:** Keep the current Next.js visual system, deploy the web process to Vercel, use PostgreSQL as the application source of truth, and run long jobs in a separate PostgreSQL-backed worker from the same repository. Server-only adapters isolate XTrace, Anthropic, object storage, public data providers, and email. The demo uses real source documents and public events while labeling synthetic private VC notes as Demo fixtures.

**Tech Stack:** Node.js 22.13+, Next.js 16, React 19, TypeScript 5.9, PostgreSQL, Drizzle ORM, Zod, Anthropic TypeScript SDK, XTrace TypeScript SDK, Vercel Blob, Resend, Vitest, Playwright.

## Global Constraints

- Preserve the existing visual design and copy style unless a new route requires additional UI.
- The app is a public single-workspace demo; do not add authentication or billing.
- The Import screen selects only preloaded corpus files and never opens a local file picker.
- The fixed corpus contains 13 product inputs and one reference-only PDF.
- Real company and market claims require `source_document` or `public_web` evidence.
- Synthetic meeting notes, Deal status, pass reasons, and revisit conditions must use `demo_fixture` provenance and display a permanent badge.
- The manual market scan covers the latest 14 days.
- A scan always creates a market summary; only medium- and high-confidence opportunities appear in Top 5.
- Candidate Deals include `screening`, `watchlist`, `evaluating`, `passed`, and `invested`; normalize `interested` to `watchlist`.
- Chat queries only existing system data and cannot browse the web or mutate Deal state.
- XTrace and Anthropic credentials remain server-side.
- XTrace ON and OFF are real retrieval modes, not presentation-only state.
- PostgreSQL-backed jobs survive browser refreshes and browser closure.
- Do not fabricate current events, company progress, citations, or email delivery state.

---

## File structure

```text
app/
  api/
    chat/route.ts
    deals/route.ts
    deals/[id]/route.ts
    documents/route.ts
    imports/preview/route.ts
    imports/confirm/route.ts
    market/events/route.ts
    overview/route.ts
    reports/route.ts
    reports/[id]/route.ts
    reports/[id]/email/route.ts
    runs/route.ts
    runs/[id]/route.ts
    runs/[id]/retry/route.ts
    search/route.ts
    settings/route.ts
    settings/health/route.ts
  components/
    app-shell.tsx
    source-list.tsx
    status-badge.tsx
  views/
    chat-view.tsx
    deal-detail-view.tsx
    deals-view.tsx
    import-view.tsx
    market-view.tsx
    overview-view.tsx
    reports-view.tsx
    runs-view.tsx
    settings-view.tsx
  page.tsx
db/
  client.ts
  schema.ts
  repositories/
    corpus.ts
    deals.ts
    market.ts
    reports.ts
    runs.ts
drizzle/
lib/
  api/
    errors.ts
    response.ts
  claude/
    client.ts
    schemas.ts
    service.ts
  contracts/
    domain.ts
    http.ts
  corpus/
    fixtures.ts
    manifest.ts
    service.ts
  email/
    service.ts
    templates.tsx
  market/
    dedupe.ts
    providers.ts
    service.ts
    types.ts
  matching/
    scoring.ts
    service.ts
  storage/
    service.ts
  xtrace/
    client.ts
    service.ts
scripts/
  seed-demo.ts
seed/
  corpus/
  manifest.json
tests/
  contracts/
  integration/
  unit/
  e2e/
worker/
  runner.ts
  stages/
    ingest-memory.ts
    market-scan.ts
    match-opportunities.ts
    send-email.ts
```

---

### Task 1: Vercel runtime, test harness, and shared contracts

**Files:**
- Modify: `package.json`
- Modify: `next.config.ts`
- Delete: `worker/index.ts`
- Create: `.env.example`
- Create: `vitest.config.ts`
- Create: `lib/contracts/domain.ts`
- Create: `lib/contracts/http.ts`
- Create: `tests/contracts/domain.test.ts`

**Interfaces:**
- Produces: `ProvenanceSchema`, `DealStatusSchema`, `RunStatusSchema`, `SourceRefSchema`, `DealMemoryBundleSchema`, `MarketEventSchema`, `OpportunityReportItemSchema`.
- Consumed by: every API route, worker stage, external-service adapter, and UI data client.

- [ ] **Step 1: Write the failing domain-contract test**

```ts
import { describe, expect, it } from "vitest";
import { DealStatusSchema, MarketEventSchema } from "../../lib/contracts/domain";

describe("domain contracts", () => {
  it("normalizes interested to watchlist", () => {
    expect(DealStatusSchema.parse("interested")).toBe("watchlist");
  });

  it("rejects a public event without evidence", () => {
    expect(() => MarketEventSchema.parse({
      id: "event_1",
      title: "New market event",
      eventType: "funding",
      sectors: ["ai"],
      themes: ["inference"],
      summary: "Capital moved.",
      positiveImplications: [],
      negativeImplications: [],
      publishedAt: "2026-07-23T12:00:00.000Z",
      confidence: "medium",
      sources: [],
    })).toThrow();
  });
});
```

- [ ] **Step 2: Run the contract test and verify failure**

Run: `npx vitest run tests/contracts/domain.test.ts`  
Expected: FAIL because `lib/contracts/domain.ts` does not exist.

- [ ] **Step 3: Add runtime dependencies and Vercel scripts**

Set scripts to:

```json
{
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "worker": "tsx worker/runner.ts",
  "test": "vitest run",
  "test:e2e": "playwright test",
  "lint": "eslint . --ignore-pattern .next",
  "typecheck": "tsc --noEmit",
  "db:generate": "drizzle-kit generate",
  "db:migrate": "drizzle-kit migrate",
  "db:seed": "tsx scripts/seed-demo.ts"
}
```

Install exact package classes:

```bash
npm install @anthropic-ai/sdk @xtraceai/memory @vercel/blob resend zod postgres fast-xml-parser cheerio
npm install -D vitest tsx @playwright/test
npm uninstall vinext @cloudflare/vite-plugin @vitejs/plugin-react @vitejs/plugin-rsc react-server-dom-webpack wrangler
```

- [ ] **Step 4: Implement the shared contract schemas**

Define the schemas with Zod:

```ts
import { z } from "zod";

export const ProvenanceSchema = z.enum([
  "source_document",
  "public_web",
  "demo_fixture",
  "model_inference",
]);

export const DealStatusSchema = z.preprocess(
  (value) => value === "interested" ? "watchlist" : value,
  z.enum(["screening", "watchlist", "evaluating", "passed", "invested"]),
);

export const RunStatusSchema = z.enum([
  "queued",
  "running",
  "partial",
  "completed",
  "failed",
]);

export const SourceRefSchema = z.object({
  id: z.string().min(1),
  provenance: ProvenanceSchema,
  title: z.string().min(1),
  url: z.string().url().optional(),
  documentId: z.string().optional(),
  page: z.number().int().positive().optional(),
  publisher: z.string().optional(),
  publishedAt: z.string().datetime().optional(),
  excerpt: z.string().min(1),
});

export const MarketEventSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  eventType: z.string().min(1),
  sectors: z.array(z.string()),
  themes: z.array(z.string()),
  summary: z.string().min(1),
  positiveImplications: z.array(z.string()),
  negativeImplications: z.array(z.string()),
  publishedAt: z.string().datetime(),
  confidence: z.enum(["low", "medium", "high"]),
  sources: z.array(SourceRefSchema).min(1),
});

export const DealMemoryBundleSchema = z.object({
  dealId: z.string().min(1),
  companyName: z.string().min(1),
  status: DealStatusSchema,
  facts: z.array(z.object({
    text: z.string().min(1),
    sources: z.array(SourceRefSchema).min(1),
  })),
  interactions: z.array(z.object({
    occurredAt: z.string().datetime(),
    summary: z.string().min(1),
    concerns: z.array(z.string()),
    revisitConditions: z.array(z.string()),
    provenance: z.literal("demo_fixture"),
  })),
});

export const OpportunityReportItemSchema = z.object({
  rank: z.number().int().min(1).max(5),
  dealId: z.string().min(1),
  confidence: z.enum(["medium", "high"]),
  score: z.number().min(0).max(1),
  whyNow: z.string().min(1),
  previousContext: z.string().min(1),
  implications: z.object({
    positive: z.array(z.string()),
    negative: z.array(z.string()),
  }),
  nextStep: z.string().min(1),
  sources: z.array(SourceRefSchema).min(1),
  demoFixtureIds: z.array(z.string()),
});

export type MarketEvent = z.infer<typeof MarketEventSchema>;
```

- [ ] **Step 5: Run contracts, typecheck, and build**

Run: `npm test && npm run typecheck && npm run build`  
Expected: all commands exit 0 and the previous Cloudflare worker type errors are gone.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json next.config.ts .env.example vitest.config.ts lib/contracts tests/contracts worker/index.ts
git commit -m "chore: establish Vercel runtime and shared contracts"
```

---

### Task 2: PostgreSQL schema and persisted run queue

**Files:**
- Modify: `drizzle.config.ts`
- Replace: `db/index.ts`
- Replace: `db/schema.ts`
- Create: `db/client.ts`
- Create: `db/repositories/runs.ts`
- Create: `tests/integration/runs-repository.test.ts`

**Interfaces:**
- Consumes: `RunStatus` from `lib/contracts/domain.ts`.
- Produces: `createRun(input)`, `claimNextRun(workerId)`, `updateRunStage(input)`, `finishRun(input)`, `getRun(id)`.

- [ ] **Step 1: Write the failing run-queue integration test**

```ts
import { afterAll, describe, expect, it } from "vitest";
import { createRun, claimNextRun, finishRun } from "../../db/repositories/runs";

describe.runIf(Boolean(process.env.TEST_DATABASE_URL))("run queue", () => {
  it("claims a queued run once and persists completion", async () => {
    const run = await createRun({
      workspaceId: "demo",
      mode: "xtrace",
      windowDays: 14,
    });
    const claimed = await claimNextRun("test-worker");
    expect(claimed?.id).toBe(run.id);
    expect(await claimNextRun("other-worker")).toBeNull();
    await finishRun({ runId: run.id, status: "completed" });
  });
});
```

- [ ] **Step 2: Run the integration test and verify failure**

Run: `TEST_DATABASE_URL="$DATABASE_URL" npx vitest run tests/integration/runs-repository.test.ts`  
Expected: FAIL because the PostgreSQL schema and repository do not exist.

- [ ] **Step 3: Define relational tables and indexes**

Implement all approved entities with UUID primary keys, timestamps, `workspace_id`, foreign keys, and JSONB for validated structured payloads. The queue claim query must use:

```sql
SELECT id
FROM scan_runs
WHERE status = 'queued'
ORDER BY created_at
FOR UPDATE SKIP LOCKED
LIMIT 1;
```

Add unique indexes for document extraction idempotency, market-event checksum, XTrace job ID, and provider canonical URL.

- [ ] **Step 4: Implement the run repository transaction**

`claimNextRun` must lock, update, and return one row in a transaction:

```ts
export async function claimNextRun(workerId: string) {
  return db.begin(async (tx) => {
    const [row] = await tx`
      SELECT * FROM scan_runs
      WHERE status = 'queued'
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `;
    if (!row) return null;
    const [claimed] = await tx`
      UPDATE scan_runs
      SET status = 'running', worker_id = ${workerId}, started_at = now()
      WHERE id = ${row.id}
      RETURNING *
    `;
    return claimed;
  });
}
```

- [ ] **Step 5: Generate and apply the migration**

Run: `DATABASE_URL="$DATABASE_URL" npm run db:generate && DATABASE_URL="$DATABASE_URL" npm run db:migrate`  
Expected: migration creates all tables and indexes without error.

- [ ] **Step 6: Run repository tests**

Run: `TEST_DATABASE_URL="$DATABASE_URL" npm test -- tests/integration/runs-repository.test.ts`  
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add db drizzle drizzle.config.ts tests/integration/runs-repository.test.ts
git commit -m "feat: add PostgreSQL persistence and run queue"
```

---

### Task 3: Fixed corpus, source storage, and Demo fixtures

**Files:**
- Create: `seed/manifest.json`
- Create: `seed/corpus/*.pdf`
- Create: `lib/corpus/manifest.ts`
- Create: `lib/corpus/fixtures.ts`
- Create: `lib/corpus/service.ts`
- Create: `lib/storage/service.ts`
- Create: `scripts/seed-demo.ts`
- Create: `tests/unit/corpus.test.ts`

**Interfaces:**
- Produces: `listPreloadedDocuments()`, `previewImport(documentIds)`, `confirmImport(input)`, `getSignedDocumentUrl(documentId)`.
- Emits: validated `DealMemoryBundle` values for Module 3.

- [ ] **Step 1: Write the failing corpus test**

```ts
import { describe, expect, it } from "vitest";
import { DEMO_FIXTURES } from "../../lib/corpus/fixtures";
import { listPreloadedDocuments } from "../../lib/corpus/manifest";

describe("demo corpus", () => {
  it("contains 13 product inputs and one reference", () => {
    const docs = listPreloadedDocuments();
    expect(docs.filter((doc) => doc.role !== "reference")).toHaveLength(13);
    expect(docs.filter((doc) => doc.role === "reference")).toHaveLength(1);
  });

  it("marks every synthetic interaction as a demo fixture", () => {
    expect(DEMO_FIXTURES.length).toBeGreaterThanOrEqual(3);
    expect(DEMO_FIXTURES.every((item) => item.provenance === "demo_fixture")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `npx vitest run tests/unit/corpus.test.ts`  
Expected: FAIL because corpus modules do not exist.

- [ ] **Step 3: Copy and checksum the 14 supplied PDFs**

Copy the exact supplied files into `seed/corpus/`, preserve human-readable filenames, and record SHA-256, byte size, role, title, and company association in `seed/manifest.json`. Run:

```bash
shasum -a 256 seed/corpus/*.pdf
```

Expected: fourteen unique checksums; the manifest has nine `deal_document`, four `market_report`, and one `reference` entries.

- [ ] **Step 4: Implement fixture selection and provenance**

Create three to five Deal scenarios after comparing pitch-deck sectors with market-report themes. Each fixture must use:

```ts
{
  provenance: "demo_fixture",
  label: "Synthetic VC decision record created for the hackathon demo",
  status: "passed" | "watchlist" | "evaluating" | "invested",
  concerns: string[],
  revisitConditions: string[],
  meetingSummary: string,
}
```

No fixture may assert a new external customer, revenue, funding, regulatory, or product fact.

- [ ] **Step 5: Implement idempotent seed and object-storage upload**

The seed command must:

1. create the demo workspace and user;
2. upsert manifest documents by checksum;
3. upload missing PDFs to a private Blob prefix;
4. create Deal/company records;
5. insert extracted source evidence and Demo fixtures;
6. leave existing run and report history intact unless `--reset` is passed.

`getSignedDocumentUrl` returns a backend URL that expires after 10 minutes; it never returns a write token.

- [ ] **Step 6: Run corpus tests and seed twice**

Run:

```bash
npm test -- tests/unit/corpus.test.ts
DATABASE_URL="$DATABASE_URL" BLOB_READ_WRITE_TOKEN="$BLOB_READ_WRITE_TOKEN" npm run db:seed
DATABASE_URL="$DATABASE_URL" BLOB_READ_WRITE_TOKEN="$BLOB_READ_WRITE_TOKEN" npm run db:seed
```

Expected: test passes; second seed reports zero duplicate documents, Deals, fixtures, or evidence rows.

- [ ] **Step 7: Commit**

```bash
git add seed lib/corpus lib/storage scripts/seed-demo.ts tests/unit/corpus.test.ts
git commit -m "feat: add fixed corpus and labeled demo fixtures"
```

---

### Task 4: XTrace memory bridge

**Files:**
- Create: `lib/xtrace/client.ts`
- Create: `lib/xtrace/service.ts`
- Create: `worker/stages/ingest-memory.ts`
- Create: `tests/unit/xtrace-service.test.ts`
- Create: `tests/integration/xtrace-live.test.ts`

**Interfaces:**
- Consumes: `DealMemoryBundle`.
- Produces: `ingestDealMemory(bundle)`, `pollIngestJob(jobId)`, `recallDealContext(input)`.

- [ ] **Step 1: Write the failing adapter test**

```ts
import { describe, expect, it, vi } from "vitest";
import { createXTraceService } from "../../lib/xtrace/service";

it("resolves recalled memory to local Deal and evidence IDs", async () => {
  const client = {
    search: vi.fn().mockResolvedValue({
      data: [{ id: "mem_1", text: "Passed until regulation changes", score: 0.91 }],
    }),
  };
  const service = createXTraceService(client as never, {
    resolveMemory: vi.fn().mockResolvedValue({
      dealId: "deal_1",
      sourceIds: ["source_1"],
      provenance: "demo_fixture",
    }),
  });
  const result = await service.recallDealContext({
    workspaceId: "demo",
    query: "Which deals were blocked by regulation?",
    candidateDealIds: ["deal_1"],
    limit: 5,
  });
  expect(result[0]).toMatchObject({ dealId: "deal_1", memoryId: "mem_1" });
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `npx vitest run tests/unit/xtrace-service.test.ts`  
Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement server-only client creation**

```ts
import "server-only";
import { MemoryClient } from "@xtraceai/memory";

export function getXTraceClient() {
  const apiKey = process.env.XTRACE_API_KEY;
  const orgId = process.env.XTRACE_ORG_ID;
  if (!apiKey || !orgId) throw new Error("XTrace credentials are not configured");
  return new MemoryClient({ apiKey, orgId });
}
```

- [ ] **Step 4: Implement ingest, polling, throttling, and recall**

Use stable `user_id`, `conv_id`, and `app_id`; serialize source and fixture labels into each interaction bundle; persist job and memory IDs. Limit dispatch to 25 requests per minute, use SDK exponential polling, cache recall by run/query hash, and throw typed `XTraceUnavailableError` on API failure.

- [ ] **Step 5: Run adapter tests**

Run: `npm test -- tests/unit/xtrace-service.test.ts`  
Expected: PASS without making a network request.

- [ ] **Step 6: Run an opt-in live smoke test**

Run:

```bash
XTRACE_LIVE_TEST=1 XTRACE_API_KEY="$XTRACE_API_KEY" XTRACE_ORG_ID="$XTRACE_ORG_ID" npx vitest run tests/integration/xtrace-live.test.ts
```

Expected: one fixture bundle reaches `succeeded`, recall returns at least one memory, and the test cleans up only the memory it created.

- [ ] **Step 7: Commit**

```bash
git add lib/xtrace worker/stages/ingest-memory.ts tests/unit/xtrace-service.test.ts tests/integration/xtrace-live.test.ts
git commit -m "feat: integrate XTrace deal memory"
```

---

### Task 5: Public market providers and 14-day normalization

**Files:**
- Create: `lib/market/types.ts`
- Create: `lib/market/providers.ts`
- Create: `lib/market/dedupe.ts`
- Create: `lib/market/service.ts`
- Create: `worker/stages/market-scan.ts`
- Create: `tests/unit/market-service.test.ts`

**Interfaces:**
- Produces: `MarketProvider.fetch({ from, to })`, `normalizeMarketItem(item)`, `dedupeEvents(events)`, `scanMarketWindow({ days: 14 })`.

- [ ] **Step 1: Write the failing recency and dedupe tests**

```ts
import { describe, expect, it } from "vitest";
import { withinWindow, dedupeEvents } from "../../lib/market/dedupe";

it("uses publication time for the 14-day window", () => {
  const now = new Date("2026-07-23T12:00:00.000Z");
  expect(withinWindow("2026-07-10T12:00:00.000Z", now, 14)).toBe(true);
  expect(withinWindow("2026-07-08T12:00:00.000Z", now, 14)).toBe(false);
});

it("deduplicates canonical URLs", () => {
  const events = [
    { id: "1", canonicalUrl: "https://example.com/a?utm_source=x" },
    { id: "2", canonicalUrl: "https://example.com/a" },
  ];
  expect(dedupeEvents(events as never)).toHaveLength(1);
});
```

- [ ] **Step 2: Run the tests and verify failure**

Run: `npx vitest run tests/unit/market-service.test.ts`  
Expected: FAIL because market modules do not exist.

- [ ] **Step 3: Implement bounded providers**

Register providers for:

- configured official VC and company announcement feeds;
- Federal Register API;
- FDA news and press-release feeds;
- SEC public releases or filings feeds;
- configured stable publisher RSS feeds;
- Crunchbase only when an authorized API key is present.

Every fetch uses a 10-second timeout, descriptive user agent, three attempts with jitter, and returns provider-scoped errors instead of throwing away other providers' results.

- [ ] **Step 4: Normalize and persist evidence**

Strip tracking parameters from canonical URLs, reject undated items, keep only published items inside the window, compute content checksums, extract an evidence excerpt, and validate each event with `MarketEventSchema`. Do not write an event when no source evidence survives validation.

- [ ] **Step 5: Run tests with recorded HTTP fixtures**

Run: `npm test -- tests/unit/market-service.test.ts tests/integration/market-providers.test.ts`  
Expected: PASS; no test requires live internet.

- [ ] **Step 6: Commit**

```bash
git add lib/market worker/stages/market-scan.ts tests/unit/market-service.test.ts tests/integration/market-providers.test.ts
git commit -m "feat: add 14-day market intelligence pipeline"
```

---

### Task 6: Claude extraction, matching, scoring, and grounded reporting

**Files:**
- Create: `lib/claude/client.ts`
- Create: `lib/claude/schemas.ts`
- Create: `lib/claude/service.ts`
- Create: `lib/matching/scoring.ts`
- Create: `lib/matching/service.ts`
- Create: `worker/stages/match-opportunities.ts`
- Create: `tests/unit/matching.test.ts`

**Interfaces:**
- Consumes: `MarketEvent[]`, structured Deals, `MemoryContext[]`.
- Produces: `matchOpportunities(input): Promise<OpportunityReportItem[]>`, `createMarketSummary(input)`.

- [ ] **Step 1: Write the failing confidence-threshold test**

```ts
import { expect, it } from "vitest";
import { rankQualifiedMatches } from "../../lib/matching/scoring";

it("keeps at most five medium-or-high confidence matches", () => {
  const matches = [
    { id: "a", confidence: "high", score: 0.9 },
    { id: "b", confidence: "low", score: 0.99 },
    { id: "c", confidence: "medium", score: 0.7 },
    { id: "d", confidence: "medium", score: 0.6 },
    { id: "e", confidence: "high", score: 0.8 },
    { id: "f", confidence: "medium", score: 0.5 },
    { id: "g", confidence: "medium", score: 0.4 },
  ];
  const result = rankQualifiedMatches(matches as never);
  expect(result).toHaveLength(5);
  expect(result.some((item) => item.id === "b")).toBe(false);
  expect(result.map((item) => item.score)).toEqual([0.9, 0.8, 0.7, 0.6, 0.5]);
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `npx vitest run tests/unit/matching.test.ts`  
Expected: FAIL because matching modules do not exist.

- [ ] **Step 3: Implement the server-only Claude client**

```ts
import "server-only";
import Anthropic from "@anthropic-ai/sdk";

export function getClaudeClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");
  return new Anthropic({ apiKey });
}
```

Use a configurable `ANTHROPIC_MODEL` environment variable. Never encode a model name in client-side code.

- [ ] **Step 4: Implement schema-first prompts**

The matching prompt receives numbered evidence blocks and must return JSON matching `OpportunityReportItemSchema`. It must:

- separate fact from inference;
- cite source IDs for each factual sentence;
- list Demo fixture IDs separately;
- return `insufficientEvidence: true` when it cannot support a claim;
- include both positive and negative implications.

Validate the result, retry once with validation errors, then persist a failed step.

- [ ] **Step 5: Implement deterministic score and citation enforcement**

Use:

```ts
score =
  0.35 * eventRelevance +
  0.30 * dealRelevance +
  0.20 * priorContextStrength +
  0.15 * evidenceQuality;
```

Remove any unsupported sentence before persistence. Convert score to `high` at `>= 0.78`, `medium` at `>= 0.58`, and exclude lower scores.

- [ ] **Step 6: Run matching tests**

Run: `npm test -- tests/unit/matching.test.ts`  
Expected: PASS, including low-confidence removal, Top 5 limit, citation removal, and XTrace ON/OFF candidate parity tests.

- [ ] **Step 7: Commit**

```bash
git add lib/claude lib/matching worker/stages/match-opportunities.ts tests/unit/matching.test.ts
git commit -m "feat: add cited opportunity matching and reports"
```

---

### Task 7: Worker pipeline and persisted stage progress

**Files:**
- Create: `worker/runner.ts`
- Modify: `worker/stages/ingest-memory.ts`
- Modify: `worker/stages/market-scan.ts`
- Modify: `worker/stages/match-opportunities.ts`
- Create: `tests/integration/worker-run.test.ts`

**Interfaces:**
- Consumes: queued `scan_runs`.
- Produces: persisted stage records, market summary, opportunity matches, report, and terminal run status.

- [ ] **Step 1: Write the failing worker-state test**

```ts
import { expect, it } from "vitest";
import { executeRun } from "../../worker/runner";

it("completes with a market summary when no match qualifies", async () => {
  const result = await executeRun("run_1", {
    scanMarket: async () => [{ id: "event_1" }],
    match: async () => [],
    summarize: async () => "No material Deal overlap found.",
  } as never);
  expect(result.status).toBe("completed");
  expect(result.report.marketSummary).toContain("No material");
  expect(result.report.opportunities).toEqual([]);
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `npx vitest run tests/integration/worker-run.test.ts`  
Expected: FAIL because `executeRun` does not exist.

- [ ] **Step 3: Implement the finite stage machine**

Stages are:

```ts
const stages = [
  "collect_market",
  "normalize_events",
  "retrieve_deals",
  "recall_memory",
  "match_opportunities",
  "create_report",
] as const;
```

Persist start, finish, counts, warnings, and error text for every stage. `recall_memory` is recorded as `skipped` in OFF mode.

- [ ] **Step 4: Implement worker polling and graceful shutdown**

Poll PostgreSQL every two seconds, claim with `SKIP LOCKED`, process one run per worker process, handle `SIGTERM`, and stop claiming new work before exit. Provider partial failure yields `partial`; missing truthful market summary yields `failed`.

- [ ] **Step 5: Run worker tests**

Run: `npm test -- tests/integration/worker-run.test.ts`  
Expected: PASS for completed, partial, failed, XTrace OFF, and retryable XTrace error paths.

- [ ] **Step 6: Commit**

```bash
git add worker tests/integration/worker-run.test.ts
git commit -m "feat: orchestrate persistent scan runs"
```

---

### Task 8: HTTP API surface

**Files:**
- Create: all routes under `app/api/` listed in the file structure
- Create: `lib/api/errors.ts`
- Create: `lib/api/response.ts`
- Create: `tests/integration/api.test.ts`

**Interfaces:**
- Consumes: repositories and service interfaces from Tasks 2–7.
- Produces: validated JSON HTTP interface from the approved design.

- [ ] **Step 1: Write the failing create-run route test**

```ts
import { expect, it } from "vitest";
import { POST } from "../../app/api/runs/route";

it("creates a persisted 14-day run", async () => {
  const request = new Request("http://localhost/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ xtraceEnabled: true }),
  });
  const response = await POST(request);
  expect(response.status).toBe(202);
  expect(await response.json()).toMatchObject({
    run: { mode: "xtrace", windowDays: 14, status: "queued" },
  });
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `npx vitest run tests/integration/api.test.ts`  
Expected: FAIL because routes do not exist.

- [ ] **Step 3: Implement common validation and error responses**

All mutation routes parse request JSON with Zod and return:

```ts
{
  error: {
    code: "VALIDATION_ERROR" | "NOT_FOUND" | "CONFLICT" | "INTEGRATION_UNAVAILABLE",
    message: string,
    retryable: boolean
  }
}
```

Never serialize stack traces or environment values.

- [ ] **Step 4: Implement route handlers**

Implement the exact minimum HTTP interface from the design. Enforce:

- one active scan per workspace/window/mode;
- no arbitrary file upload;
- import document IDs must exist in the manifest;
- Chat cannot invoke market providers;
- report email and outreach are separate jobs;
- signed document URLs expire.

- [ ] **Step 5: Run API tests**

Run: `npm test -- tests/integration/api.test.ts`  
Expected: PASS for happy paths, invalid input, duplicate run, missing integration, and unknown ID.

- [ ] **Step 6: Commit**

```bash
git add app/api lib/api tests/integration/api.test.ts
git commit -m "feat: expose persistent product APIs"
```

---

### Task 9: Frontend shell and real persisted views

**Files:**
- Refactor: `app/page.tsx`
- Create: `app/components/app-shell.tsx`
- Create: `app/components/source-list.tsx`
- Create: `app/components/status-badge.tsx`
- Create: all files under `app/views/`
- Modify: `app/globals.css`
- Create: `tests/rendered-html.test.mjs`

**Interfaces:**
- Consumes: HTTP responses from Task 8.
- Produces: Overview, Deals, Deal detail, Market, Import, Reports, Runs, Chat, and Settings experiences.

- [ ] **Step 1: Replace stale rendered-HTML tests with product assertions**

```js
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";

async function renderHome() {
  const server = spawn("npm", ["run", "start"], {
    env: { ...process.env, PORT: "3137" },
    stdio: "ignore",
  });
  await new Promise((resolve) => setTimeout(resolve, 1500));
  try {
    return await fetch("http://127.0.0.1:3137").then((response) => response.text());
  } finally {
    server.kill("SIGTERM");
  }
}

test("public shell exposes persistent product navigation", async () => {
  const html = await renderHome();
  for (const label of ["Overview", "Deals", "Market", "Import", "Reports", "Runs", "Chat"]) {
    assert.match(html, new RegExp(label));
  }
  assert.match(html, /Demo corpus preloaded/);
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `npm test`  
Expected: FAIL because the current single-page prototype does not expose the required persistent navigation.

- [ ] **Step 3: Extract the current design into the app shell**

Preserve current typography, spacing, colors, panels, pills, left navigation, opportunity cards, and evidence drawer. Remove top-level hardcoded arrays and timer-based scan state from `app/page.tsx`.

- [ ] **Step 4: Connect views to APIs**

Use server components for initial read views and client components only for filters, polling, forms, drawers, and Chat. Run polling starts at 1 second and backs off to 5 seconds. Every mutation shows queued/running/success/failure based on persisted API state.

- [ ] **Step 5: Implement the preloaded Import experience**

Render the label “Demo corpus preloaded,” list the 14 manifest documents, preview classification, require company/Deal confirmation for pitch decks, and display source-document and Demo-fixture provenance separately.

- [ ] **Step 6: Implement evidence inspection and XTrace comparison**

Source cards open signed document URLs at the cited page when available. The XTrace toggle changes the next run mode and the UI explains that ON recalls XTrace memory while OFF uses structured PostgreSQL retrieval.

- [ ] **Step 7: Run UI checks**

Run: `npm test && npm run lint && npm run typecheck && npm run build`  
Expected: all exit 0 with no ESLint warnings.

- [ ] **Step 8: Commit**

```bash
git add app tests/rendered-html.test.mjs
git commit -m "feat: connect existing frontend to persistent workflows"
```

---

### Task 10: Report email, founder outreach, Search, and grounded Chat

**Files:**
- Create: `lib/email/service.ts`
- Create: `lib/email/templates.tsx`
- Create: `worker/stages/send-email.ts`
- Modify: relevant API routes from Task 8
- Modify: `app/views/reports-view.tsx`
- Modify: `app/views/chat-view.tsx`
- Create: `tests/unit/email.test.ts`
- Create: `tests/integration/chat.test.ts`

**Interfaces:**
- Produces: `queueReportEmail(reportId)`, `queueOutreach(opportunityId, editedBody)`, `answerGroundedQuestion(input)`.

- [ ] **Step 1: Write failing email and Chat tests**

```ts
import { expect, it } from "vitest";
import { renderReportEmail } from "../../lib/email/templates";

it("includes market summary, citations, and no low-confidence match", () => {
  const reportFixture = {
    marketSummary: "AI infrastructure funding remains active.",
    opportunities: [{
      confidence: "high",
      companyName: "Ably",
      whyNow: "Infrastructure demand increased.",
      sources: [{
        title: "Q1 2026 AI VC Trends",
        href: "https://example.com/source",
      }],
    }],
  };
  const html = renderReportEmail(reportFixture);
  expect(html).toContain("Market summary");
  expect(html).toContain("Sources");
  expect(html).not.toContain("Low confidence");
});
```

```ts
import { vi } from "vitest";
import { createChatService } from "../../lib/claude/service";

it("does not browse when Chat lacks evidence", async () => {
  const providerFetchSpy = vi.fn();
  const answerGroundedQuestion = createChatService({
    searchExistingData: vi.fn().mockResolvedValue([]),
    fetchPublicMarketData: providerFetchSpy,
  }).answerGroundedQuestion;
  const answer = await answerGroundedQuestion({
    workspaceId: "demo",
    question: "What happened today to an unknown company?",
  });
  expect(answer.text).toMatch(/insufficient/i);
  expect(providerFetchSpy).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the tests and verify failure**

Run: `npx vitest run tests/unit/email.test.ts tests/integration/chat.test.ts`  
Expected: FAIL because email and Chat services do not exist.

- [ ] **Step 3: Implement Resend delivery**

Create separate templates and queue types for:

- VC intelligence report;
- founder outreach.

Persist recipient, subject, provider message ID, attempt count, status, and last error. A report remains completed when email fails.

- [ ] **Step 4: Implement grounded Search and Chat**

Search filters PostgreSQL entities deterministically. Chat retrieves local records and XTrace context, calls Claude with numbered evidence, validates citations, and returns:

```ts
{
  answer: string;
  citations: SourceRef[];
  usedXTrace: boolean;
  insufficientEvidence: boolean;
}
```

No Chat path imports or calls a market provider.

- [ ] **Step 5: Run tests**

Run: `npm test -- tests/unit/email.test.ts tests/integration/chat.test.ts`  
Expected: PASS, including provider failure, retry, missing citation, and insufficient-evidence cases.

- [ ] **Step 6: Commit**

```bash
git add lib/email worker/stages/send-email.ts app/api app/views/reports-view.tsx app/views/chat-view.tsx tests/unit/email.test.ts tests/integration/chat.test.ts
git commit -m "feat: add email delivery and grounded chat"
```

---

### Task 11: End-to-end demo, security, and deployment documentation

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/demo-flow.spec.ts`
- Replace: `README.md`
- Create: `docs/demo-script.md`
- Create: `vercel.json`

**Interfaces:**
- Consumes: the complete application.
- Produces: a reproducible public deployment and verified live demo flow.

- [ ] **Step 1: Write the end-to-end flow**

```ts
import { expect, test } from "@playwright/test";

test("preloaded document to cited opportunity report", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Import" }).click();
  await expect(page.getByText("Demo corpus preloaded")).toBeVisible();
  await page.getByRole("checkbox", { name: /Ada Health Pitch Deck/i }).check();
  await page.getByRole("button", { name: "Preview import" }).click();
  await page.getByRole("button", { name: "Confirm Deal" }).click();
  await page.getByRole("link", { name: "Overview" }).click();
  await page.getByRole("button", { name: "Run 14-day scan" }).click();
  await expect(page.getByText(/completed|partial/i)).toBeVisible({ timeout: 120_000 });
  await page.getByRole("link", { name: "Latest report" }).click();
  await expect(page.getByText("Market summary")).toBeVisible();
  await expect(page.getByText(/Demo fixture/i)).toBeVisible();
  await expect(page.getByRole("link", { name: /source/i }).first()).toBeVisible();
});
```

- [ ] **Step 2: Run E2E and verify any remaining failures**

Run: `npx playwright install chromium && npm run test:e2e`  
Expected: the test reaches the first unimplemented or broken integration and fails with a specific assertion.

- [ ] **Step 3: Add production environment and security checks**

Document and validate:

```text
DATABASE_URL
ANTHROPIC_API_KEY
ANTHROPIC_MODEL
XTRACE_API_KEY
XTRACE_ORG_ID
BLOB_READ_WRITE_TOKEN
RESEND_API_KEY
REPORT_FROM_EMAIL
REPORT_TO_EMAIL
PUBLIC_APP_URL
```

Add startup health checks that report only configured/not configured. Search the production bundle for secret prefixes before deployment.

- [ ] **Step 4: Write deployment and demo documentation**

README must include:

- Vercel web deployment;
- separate worker deployment and command;
- migration and seed order;
- XTrace and Anthropic setup;
- object-storage and Resend setup;
- provider configuration;
- live versus recorded test commands;
- rollback procedure.

`docs/demo-script.md` must include a three-minute path, expected evidence, XTrace ON/OFF comparison, and recovery route if an external provider is temporarily unavailable.

- [ ] **Step 5: Run the complete verification suite**

Run:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
git diff --check
```

Expected: every command exits 0; no tests use fabricated public events; production browser assets do not contain API keys.

- [ ] **Step 6: Commit**

```bash
git add playwright.config.ts tests/e2e README.md docs/demo-script.md vercel.json
git commit -m "test: verify and document public demo deployment"
```

---

## Five-person ownership map

| Person | Primary ownership | First independent deliverable | Integration dependency |
| --- | --- | --- | --- |
| 1 | Module 1 — Web App and Orchestrator | App shell and API-backed views using contract fixtures | Shared contracts from Task 1 |
| 2 | Module 2 — Corpus and Deal Extraction | Manifest, seed, fixtures, Import preview/confirm | PostgreSQL schema from Task 2 |
| 3 | Module 3 — XTrace Memory Bridge | Mock-tested ingest/recall adapter and live smoke test | DealMemoryBundle from Task 1 |
| 4 | Module 4 — Market Intelligence | Provider adapters, 14-day normalization, recorded tests | MarketEvent from Task 1 |
| 5 | Module 5 — Matching, Reports, Email, Chat | Matching/scoring with contract fixtures | MarketEvent and MemoryContext |

Tasks 1 and 2 are integration foundations and should be pair-reviewed on day one. After their interfaces are merged, each person can develop against shared JSON fixtures. Task 7 joins Modules 3–5 through the persisted worker. Tasks 8–11 are integration and hardening work shared across the team.
