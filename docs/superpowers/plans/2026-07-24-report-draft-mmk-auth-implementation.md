# Internal Report Draft and XTrace mmk Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace report email delivery with a browser-local, copy-ready internal VC/GP report draft and make the current XTrace `mmk_` API key work without an Organization ID.

**Architecture:** XTrace configuration is centralized in `lib/xtrace/client.ts`, where the current `mmk_` flow sends only `Authorization: Bearer <key>`. A pure report-draft formatter converts an existing persisted report plus Deal names into deterministic plain text with inspectable absolute citations. A focused client dialog presents editable Subject and Message fields and copies text locally; the obsolete Resend route, delivery state, database function, and environment settings are removed.

**Tech Stack:** Next.js 16, React 19, TypeScript 5.9, native HTML `<dialog>`, Node test runner, Supabase PostgreSQL/Storage, XTrace Memory Manager.

## Global Constraints

- The existing dark/lime frontend design remains recognizable; do not redesign navigation, reports, or page structure.
- The report is an internal investment-intelligence draft for a VC Partner or GP, never founder outreach.
- The action label is exactly `DRAFT THIS REPORT →`.
- The composer has editable `Subject` and `Message` fields and no `To` field.
- The composer actions are `COPY BODY`, `COPY FULL DRAFT`, and `CLOSE`; nothing sends email or mutates persisted state.
- The default subject is `VSee · Deals worth a second look — YYYY-MM-DD`.
- The draft body contains the 14-day market summary, at most five ranked opportunities, confidence and score, why now, previous context, positive and negative implications when present, suggested next step, source titles with absolute URLs, and an absolute complete-report URL.
- A zero-match report remains truthful and states that no medium- or high-confidence Deal overlap was found.
- The current `mmk_` XTrace flow requires `XTRACE_API_KEY` only and must omit `X-Org-Id`, even if a stale `XTRACE_ORG_ID` environment variable exists.
- `XTRACE_ORG_ID` is not required by health checks, import, scan creation, Chat recall, or the worker when `XTRACE_API_KEY` begins with `mmk_`.
- Legacy non-`mmk_` keys may retain compatibility with an Organization ID, but legacy authentication is not a required demo path.
- API keys remain server-side and must never appear in browser JavaScript, logs, fixtures, commits, or test output.
- Existing report persistence, market scanning, opportunity matching, citations, document access, and read-only Chat behavior must remain unchanged.
- Use TDD for every behavior change: add a focused failing test, run it and observe the expected failure, implement the smallest change, then rerun the focused test and related regression tests.

---

### Task 1: XTrace `mmk_` single-key authentication

**Files:**
- Modify: `lib/xtrace/client.ts`
- Modify: `app/api/imports/confirm/route.ts`
- Modify: `app/api/runs/route.ts`
- Modify: `app/api/chat/route.ts`
- Modify: `app/api/settings/health/route.ts`
- Modify: `worker/runner.ts`
- Modify: `tests/unit/xtrace-service.test.ts`
- Modify: `tests/unit/ui-hardening.test.ts`

**Interfaces:**
- Consumes: `process.env.XTRACE_API_KEY`, optional `process.env.XTRACE_ORG_ID`, and existing `createXTraceClient`.
- Produces: `isXTraceConfigured(environment?: NodeJS.ProcessEnv): boolean`; `createXTraceClient({ apiKey, orgId?, baseUrl?, fetch? })`; `getXTraceClient()` that accepts `mmk_` without an Organization ID.

- [ ] **Step 1: Add failing tests for current single-key behavior**

Add these imports and tests to `tests/unit/xtrace-service.test.ts`:

```ts
import {
  createXTraceClient,
  isXTraceConfigured,
} from "../../lib/xtrace/client";

test("mmk XTrace requests omit the organization header even when a stale org ID exists", async () => {
  let headers = new Headers();
  const client = createXTraceClient({
    apiKey: "mmk_test",
    orgId: "stale_org",
    fetch: async (_url, init) => {
      headers = new Headers(init?.headers);
      return Response.json({ data: [] });
    },
  });

  await client.search({
    query: "health",
    user_id: "workspace:demo",
    mode: "retrieve",
    limit: 1,
  });

  assert.equal(headers.get("authorization"), "Bearer mmk_test");
  assert.equal(headers.get("x-org-id"), null);
});

test("XTrace configuration accepts mmk without an organization ID", () => {
  assert.equal(isXTraceConfigured({ XTRACE_API_KEY: "mmk_test" }), true);
  assert.equal(isXTraceConfigured({
    XTRACE_API_KEY: "legacy_test",
    XTRACE_ORG_ID: "org_test",
  }), true);
  assert.equal(isXTraceConfigured({ XTRACE_API_KEY: "legacy_test" }), false);
  assert.equal(isXTraceConfigured({}), false);
});
```

Keep the existing legacy-header assertion for a non-`mmk_` test key.

Add a focused health assertion to `tests/unit/ui-hardening.test.ts` that temporarily sets `XTRACE_API_KEY="mmk_test"`, deletes `XTRACE_ORG_ID`, calls `getHealth()`, and asserts `body.data.xtrace === true`, restoring both variables in `finally`.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
node --import tsx --test tests/unit/xtrace-service.test.ts tests/unit/ui-hardening.test.ts
```

Expected: FAIL because `isXTraceConfigured` is not exported and health currently requires `XTRACE_ORG_ID`.

- [ ] **Step 3: Implement centralized authentication and configuration**

Change the client options and header construction in `lib/xtrace/client.ts` to:

```ts
type XTraceEnvironment = Pick<
  NodeJS.ProcessEnv,
  "XTRACE_API_KEY" | "XTRACE_ORG_ID"
>;

export function isXTraceConfigured(
  environment: XTraceEnvironment = process.env,
): boolean {
  const apiKey = environment.XTRACE_API_KEY?.trim();
  if (!apiKey) return false;
  return apiKey.startsWith("mmk_")
    || Boolean(environment.XTRACE_ORG_ID?.trim());
}

export function createXTraceClient(options: {
  apiKey: string;
  orgId?: string;
  baseUrl?: string;
  fetch?: FetchLike;
}): XTraceClient {
  const baseUrl = (options.baseUrl ?? XTRACE_API_BASE_URL).replace(/\/$/, "");
  const fetchImpl = options.fetch ?? fetch;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${options.apiKey}`,
    "Content-Type": "application/json",
  };
  if (!options.apiKey.startsWith("mmk_") && options.orgId?.trim()) {
    headers["X-Org-Id"] = options.orgId.trim();
  }
  // Keep the existing request and method implementations unchanged.
}
```

Replace `getXTraceClient()` configuration with:

```ts
export function getXTraceClient(): XTraceClient {
  if (typeof window !== "undefined") {
    throw new XTraceConfigurationError("XTrace client may only be created on the server");
  }
  if (!isXTraceConfigured()) throw new XTraceConfigurationError();

  const apiKey = process.env.XTRACE_API_KEY!.trim();
  return createXTraceClient({
    apiKey,
    orgId: apiKey.startsWith("mmk_")
      ? undefined
      : process.env.XTRACE_ORG_ID?.trim(),
    baseUrl: process.env.XTRACE_API_BASE_URL,
  });
}
```

Import and use `isXTraceConfigured()` in the five callers:

```ts
import {
  getXTraceClient,
  isXTraceConfigured,
} from ".../lib/xtrace/client";
```

Then replace every local `XTRACE_API_KEY && XTRACE_ORG_ID` check with `isXTraceConfigured()`. Specifically:

```ts
const xtraceConfigured = isXTraceConfigured();
```

```ts
if (parsed.xtraceEnabled && !isXTraceConfigured()) {
  return jsonError(
    "INTEGRATION_UNAVAILABLE",
    "XTrace is required for an XTrace-mode scan.",
    503,
    true,
  );
}
```

```ts
if (!isXTraceConfigured()) return [];
```

```ts
xtrace: isXTraceConfigured(),
```

```ts
const xtraceService = isXTraceConfigured()
  ? createXTraceService(getXTraceClient(), {
      workspaceId: claimed.workspaceId,
      lineageRepository: lineage,
    })
  : undefined;
```

- [ ] **Step 4: Run focused and related tests and verify GREEN**

Run:

```bash
node --import tsx --test tests/unit/xtrace-service.test.ts tests/unit/ui-hardening.test.ts tests/integration/process-run.test.ts
npm run typecheck
```

Expected: all tests pass and TypeScript exits 0.

- [ ] **Step 5: Commit**

```bash
git add lib/xtrace/client.ts app/api/imports/confirm/route.ts app/api/runs/route.ts app/api/chat/route.ts app/api/settings/health/route.ts worker/runner.ts tests/unit/xtrace-service.test.ts tests/unit/ui-hardening.test.ts
git commit -m "fix: support XTrace mmk single-key auth"
```

---

### Task 2: Deterministic internal report-draft formatter

**Files:**
- Create: `lib/reports/draft.ts`
- Create: `tests/unit/report-draft.test.ts`

**Interfaces:**
- Consumes: persisted report fields compatible with `OpportunityReportItem`, Deal-ID-to-company-name mapping, and browser origin.
- Produces: `buildInternalReportDraft(input: InternalReportDraftInput): InternalReportDraft` and `buildFullDraftText(draft: InternalReportDraft): string`.

- [ ] **Step 1: Write failing formatter tests**

Create `tests/unit/report-draft.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFullDraftText,
  buildInternalReportDraft,
} from "../../lib/reports/draft";

const report = {
  id: "report_1",
  createdAt: "2026-07-24T17:30:00.000Z",
  marketSummary: "AI infrastructure funding accelerated during the 14-day window.",
  opportunities: [{
    rank: 1,
    dealId: "deal_ably",
    confidence: "high" as const,
    score: 0.87,
    whyNow: "Infrastructure demand increased.",
    previousContext: "The fund previously passed because the timing was early.",
    implications: {
      positive: ["The addressable market may expand."],
      negative: ["Competition may increase."],
    },
    nextStep: "Review the source evidence and decide whether to reconnect.",
    sources: [
      {
        id: "public_1",
        provenance: "public_web" as const,
        title: "Funding announcement",
        url: "https://news.example/funding",
        page: 2,
        excerpt: "Funding activity increased.",
      },
      {
        id: "document_1",
        provenance: "source_document" as const,
        title: "Ably pitch deck",
        documentId: "doc ably",
        page: 4,
        excerpt: "Ably provides realtime infrastructure.",
      },
    ],
    demoFixtureIds: ["fixture_1"],
  }],
};

test("builds a cited internal VC report draft without a recipient", () => {
  const draft = buildInternalReportDraft({
    report,
    companyNames: { deal_ably: "Ably" },
    appOrigin: "https://vsee.example/",
  });

  assert.equal(
    draft.subject,
    "VSee · Deals worth a second look — 2026-07-24",
  );
  assert.match(draft.bodyText, /14-DAY MARKET SUMMARY/);
  assert.match(draft.bodyText, /#1 · ABLY · HIGH CONFIDENCE · 87%/);
  assert.match(draft.bodyText, /Why now:\\nInfrastructure demand increased/);
  assert.match(draft.bodyText, /Potential positive effects/);
  assert.match(draft.bodyText, /Potential negative effects/);
  assert.match(
    draft.bodyText,
    /https:\/\/news\.example\/funding#page=2/,
  );
  assert.match(
    draft.bodyText,
    /https:\/\/vsee\.example\/api\/documents\/doc%20ably\/access#page=4/,
  );
  assert.match(
    draft.bodyText,
    /https:\/\/vsee\.example\/\?view=reports&report=report_1/,
  );
  assert.doesNotMatch(`${draft.subject}\n${draft.bodyText}`, /^To:/m);
  assert.doesNotMatch(draft.bodyText, /Hi founder|outreach/i);
});

test("keeps a zero-match market report truthful", () => {
  const draft = buildInternalReportDraft({
    report: { ...report, opportunities: [] },
    companyNames: {},
    appOrigin: "https://vsee.example",
  });

  assert.match(
    draft.bodyText,
    /No medium- or high-confidence Deal overlap was found/,
  );
});

test("copies the full draft as subject followed by body", () => {
  assert.equal(
    buildFullDraftText({ subject: "Subject line", bodyText: "Message body" }),
    "Subject: Subject line\n\nMessage body",
  );
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node --import tsx --test tests/unit/report-draft.test.ts
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `lib/reports/draft`.

- [ ] **Step 3: Implement the pure formatter**

Create `lib/reports/draft.ts`:

```ts
import type {
  OpportunityReportItem,
  SourceRef,
} from "../contracts/domain";

export interface InternalReportDraft {
  subject: string;
  bodyText: string;
}

export interface InternalReportDraftInput {
  report: {
    id: string;
    createdAt: string;
    marketSummary: string;
    opportunities: OpportunityReportItem[];
  };
  companyNames: Readonly<Record<string, string>>;
  appOrigin: string;
}

export function buildInternalReportDraft(
  input: InternalReportDraftInput,
): InternalReportDraft {
  const origin = input.appOrigin.replace(/\/+$/, "");
  const reportDate = input.report.createdAt.slice(0, 10);
  const opportunities = input.report.opportunities.slice(0, 5);
  const bodySections = opportunities.length
    ? opportunities.map((opportunity) =>
        formatOpportunity(opportunity, input.companyNames, origin)
      )
    : ["No medium- or high-confidence Deal overlap was found."];
  const reportUrl =
    `${origin}/?view=reports&report=${encodeURIComponent(input.report.id)}`;

  return {
    subject: `VSee · Deals worth a second look — ${reportDate}`,
    bodyText: [
      "VSEE · DEAL INTELLIGENCE",
      "",
      "14-DAY MARKET SUMMARY",
      input.report.marketSummary,
      "",
      ...bodySections.flatMap((section) => [section, ""]),
      "OPEN COMPLETE REPORT",
      reportUrl,
    ].join("\n").trim(),
  };
}

export function buildFullDraftText(draft: InternalReportDraft): string {
  return `Subject: ${draft.subject}\n\n${draft.bodyText}`;
}

function formatOpportunity(
  opportunity: OpportunityReportItem,
  companyNames: Readonly<Record<string, string>>,
  origin: string,
): string {
  const companyName = companyNames[opportunity.dealId] ?? opportunity.dealId;
  const lines = [
    `#${opportunity.rank} · ${companyName.toUpperCase()} · ${opportunity.confidence.toUpperCase()} CONFIDENCE · ${Math.round(opportunity.score * 100)}%`,
    "",
    "Why now:",
    opportunity.whyNow,
    "",
    "Previous context:",
    opportunity.previousContext,
  ];

  appendList(lines, "Potential positive effects:", opportunity.implications.positive);
  appendList(lines, "Potential negative effects:", opportunity.implications.negative);
  lines.push(
    "",
    "Suggested next step:",
    opportunity.nextStep,
    "",
    "Sources:",
    ...opportunity.sources.map((source) => formatSource(source, origin)),
  );
  return lines.join("\n");
}

function appendList(lines: string[], heading: string, items: string[]): void {
  if (!items.length) return;
  lines.push("", heading, ...items.map((item) => `- ${item}`));
}

function formatSource(source: SourceRef, origin: string): string {
  const url = resolveSourceUrl(source, origin);
  return url ? `- ${source.title} — ${url}` : `- ${source.title}`;
}

function resolveSourceUrl(source: SourceRef, origin: string): string | undefined {
  if (source.url) {
    const url = new URL(source.url);
    if (source.page && !url.hash) url.hash = `page=${source.page}`;
    return url.toString();
  }
  if (!source.documentId) return undefined;
  const page = source.page ? `#page=${source.page}` : "";
  return `${origin}/api/documents/${encodeURIComponent(source.documentId)}/access${page}`;
}
```

- [ ] **Step 4: Run focused tests, typecheck, and verify GREEN**

Run:

```bash
node --import tsx --test tests/unit/report-draft.test.ts
npm run typecheck
```

Expected: three passing tests and TypeScript exits 0.

- [ ] **Step 5: Commit**

```bash
git add lib/reports/draft.ts tests/unit/report-draft.test.ts
git commit -m "feat: build internal VC report drafts"
```

---

### Task 3: Accessible report-draft composer in the existing UI

**Files:**
- Create: `app/report-draft-dialog.tsx`
- Modify: `app/page.tsx`
- Modify: `app/vsee.css`
- Modify: `tests/unit/ui-hardening.test.ts`

**Interfaces:**
- Consumes: `InternalReportDraft`, `buildInternalReportDraft`, and `buildFullDraftText` from Task 2.
- Produces: `ReportDraftDialog({ draft, onClose })`; the Reports view calls `onDraft(report)` for the newest report.

- [ ] **Step 1: Add failing static UI contract tests**

Extend `tests/unit/ui-hardening.test.ts` with paths for the dialog and draft helper and add:

```ts
const dialogPath = new URL("../../app/report-draft-dialog.tsx", import.meta.url);

test("reports open an editable internal draft dialog without sending email", async () => {
  const [page, dialog, css] = await Promise.all([
    readFile(pagePath, "utf8"),
    readFile(dialogPath, "utf8"),
    readFile(cssPath, "utf8"),
  ]);

  assert.match(page, /DRAFT THIS REPORT →/);
  assert.match(page, /buildInternalReportDraft/);
  assert.match(dialog, /<dialog/);
  assert.match(dialog, /Subject/);
  assert.match(dialog, /Message/);
  assert.match(dialog, /COPY BODY/);
  assert.match(dialog, /COPY FULL DRAFT/);
  assert.match(dialog, /aria-live="polite"/);
  assert.doesNotMatch(dialog, />To</);
  assert.doesNotMatch(page, /\/api\/reports\/\$\{latestReport\.id\}\/email/);
  assert.doesNotMatch(page, /EMAIL THIS REPORT|EMAIL SENT|SENDING…/);
  assert.match(css, /\.vsee-draft-dialog::backdrop/);
  assert.match(css, /@media\\(max-width:680px\\).*\\.vsee-draft-dialog/s);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --import tsx --test tests/unit/ui-hardening.test.ts
```

Expected: FAIL because `app/report-draft-dialog.tsx` does not exist.

- [ ] **Step 3: Implement the client dialog**

Create `app/report-draft-dialog.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";

import {
  buildFullDraftText,
  type InternalReportDraft,
} from "../lib/reports/draft";

export function ReportDraftDialog({
  draft,
  onClose,
}: {
  draft: InternalReportDraft | null;
  onClose(): void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [copyState, setCopyState] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (draft) {
      setSubject(draft.subject);
      setBody(draft.bodyText);
      setCopyState("");
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [draft]);

  async function copy(value: string, success: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyState(success);
    } catch {
      setCopyState("Copy unavailable — select the text manually.");
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="vsee-draft-dialog"
      aria-labelledby="report-draft-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
    >
      <form method="dialog" className="vsee-draft-composer">
        <header>
          <div>
            <span>INTERNAL VC / GP BRIEF</span>
            <h2 id="report-draft-title">Draft this report</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close report draft">
            ×
          </button>
        </header>
        <main>
          <label>
            <span>Subject</span>
            <input
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              autoFocus
            />
          </label>
          <label>
            <span>Message</span>
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={20}
            />
          </label>
        </main>
        <footer>
          <p aria-live="polite">{copyState}</p>
          <div>
            <button type="button" onClick={() => void copy(body, "BODY COPIED ✓")}>
              COPY BODY
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => void copy(
                buildFullDraftText({ subject, bodyText: body }),
                "FULL DRAFT COPIED ✓",
              )}
            >
              COPY FULL DRAFT
            </button>
            <button type="button" onClick={onClose}>CLOSE</button>
          </div>
        </footer>
      </form>
    </dialog>
  );
}
```

- [ ] **Step 4: Wire the dialog into Reports**

In `app/page.tsx`:

```ts
import { ReportDraftDialog } from "./report-draft-dialog";
import {
  buildInternalReportDraft,
  type InternalReportDraft,
} from "../lib/reports/draft";
```

Remove `Report.delivery`, remove `Health.email`, remove `sendLatestReport()`, and add:

```ts
const [reportDraft, setReportDraft] = useState<InternalReportDraft | null>(null);

function draftReport(report: Report) {
  if (!overview) return;
  setReportDraft(buildInternalReportDraft({
    report,
    companyNames: Object.fromEntries(
      overview.deals.map((deal) => [deal.id, deal.companyName]),
    ),
    appOrigin: window.location.origin,
  }));
}
```

Change the Reports call to:

```tsx
<ReportsView
  reports={reports}
  deals={overview.deals}
  onDraft={draftReport}
  focusedReportId={focusedReportId}
/>
```

Render once, immediately before the closing `</main>`:

```tsx
<ReportDraftDialog
  draft={reportDraft}
  onClose={() => setReportDraft(null)}
/>
```

Change `ReportsView` props from `onEmail`/`busy` to:

```ts
onDraft(report: Report): void;
```

and make the newest report action:

```tsx
<button onClick={() => onDraft(report)}>
  DRAFT THIS REPORT →
</button>
```

Change Overview step 4 copy to:

```ts
"Rank a cited Top 5 and prepare a copy-ready internal brief for the investor."
```

Remove the Email item from `SettingsView`.

- [ ] **Step 5: Add desktop and mobile dialog styles**

Append to `app/vsee.css`:

```css
.vsee-draft-dialog{width:min(760px,calc(100vw - 36px));max-height:calc(100vh - 40px);padding:0;border:1px solid #465047;background:#0b0e0c;color:var(--text);box-shadow:0 28px 90px rgba(0,0,0,.7)}
.vsee-draft-dialog::backdrop{background:rgba(0,0,0,.78);backdrop-filter:blur(5px)}
.vsee-draft-composer{max-height:inherit;display:grid;grid-template-rows:auto minmax(0,1fr) auto}
.vsee-draft-composer>header{min-height:78px;padding:16px 20px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between}
.vsee-draft-composer>header span,.vsee-draft-composer label>span{color:var(--lime);font:700 9px var(--mono);letter-spacing:.13em;text-transform:uppercase}
.vsee-draft-composer h2{margin:7px 0 0;font:400 28px var(--serif)}
.vsee-draft-composer>header button{width:38px;height:38px;border:1px solid var(--line);background:transparent;color:#9ba49e;cursor:pointer;font-size:22px}
.vsee-draft-composer>main{padding:20px;overflow:auto;display:grid;gap:17px}
.vsee-draft-composer label{display:grid;gap:8px}
.vsee-draft-composer input,.vsee-draft-composer textarea{width:100%;border:1px solid #343c37;background:#080b09;color:#dce2dd;padding:13px;outline:0;font:500 13px/1.6 var(--mono);resize:vertical}
.vsee-draft-composer input:focus,.vsee-draft-composer textarea:focus{border-color:var(--lime)}
.vsee-draft-composer>footer{min-height:76px;padding:14px 20px;border-top:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;gap:16px}
.vsee-draft-composer>footer p{min-height:16px;margin:0;color:#9ea8a1;font:600 9px var(--mono)}
.vsee-draft-composer>footer>div{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end}
.vsee-draft-composer>footer button{height:38px;padding:0 13px;border:1px solid #39423c;background:#0c0f0d;color:#aab3ad;cursor:pointer;font:700 9px var(--mono);letter-spacing:.08em}
.vsee-draft-composer>footer button.primary{border-color:var(--lime);background:var(--lime);color:#080b09}
@media(max-width:680px){.vsee-draft-dialog{width:100vw;max-width:none;max-height:calc(100dvh - 12px);margin:auto 0 0;border-width:1px 0 0}.vsee-draft-composer>header{position:sticky;top:0;background:#0b0e0c;z-index:1}.vsee-draft-composer>main{padding:16px}.vsee-draft-composer input,.vsee-draft-composer textarea{font-size:16px}.vsee-draft-composer>footer{position:sticky;bottom:0;background:#0b0e0c;align-items:stretch;flex-direction:column}.vsee-draft-composer>footer>div{display:grid;grid-template-columns:1fr 1fr}.vsee-draft-composer>footer button:last-child{grid-column:1/-1}}
```

- [ ] **Step 6: Run focused tests and full static checks**

Run:

```bash
node --import tsx --test tests/unit/report-draft.test.ts tests/unit/ui-hardening.test.ts
npm run typecheck
npm run lint
```

Expected: all tests pass; typecheck and lint exit 0.

- [ ] **Step 7: Commit**

```bash
git add app/report-draft-dialog.tsx app/page.tsx app/vsee.css tests/unit/ui-hardening.test.ts
git commit -m "feat: add internal report draft composer"
```

---

### Task 4: Remove obsolete email delivery and persisted delivery state

**Files:**
- Delete: `app/api/reports/[id]/email/route.ts`
- Delete: `lib/email/service.ts`
- Delete: `lib/email/templates.ts`
- Delete directory if empty: `lib/email`
- Move: `tests/unit/email-chat.test.ts` to `tests/unit/chat-service.test.ts`
- Modify: `db/repositories/intelligence.ts`
- Modify: `lib/reports/public.ts`
- Modify: `db/schema.ts`
- Modify: `drizzle/0000_vsee_postgres.sql`
- Modify: `lib/api/safety.ts`
- Modify: `tests/unit/intelligence-repository.test.ts`
- Modify: `tests/unit/api-safety.test.ts`
- Modify: `tests/integration/process-run.test.ts`
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-07-23-xtrace-vc-demo-integration-design.md` only if implementation revealed a mismatch.

**Interfaces:**
- Consumes: existing report save/get/list repository methods.
- Produces: reports without `delivery`; no email endpoint, service, provider configuration, recipient allowlist, or delivery SQL function.

- [ ] **Step 1: Convert old email tests into failing removal contracts**

Move `tests/unit/email-chat.test.ts` to `tests/unit/chat-service.test.ts` and remove the two email imports and two email tests, preserving every grounded Chat test unchanged.

In `tests/unit/intelligence-repository.test.ts`, remove `readFile`, delivery-claim tests, and add:

```ts
test("public reports contain intelligence only and no delivery state", async () => {
  const repository = createMemoryIntelligenceRepository();
  const report = await repository.saveReport({
    id: "report_plain",
    workspaceId: "workspace_demo",
    runId: "run_plain",
    createdAt: "2026-07-23T12:00:00.000Z",
    marketSummary: "Summary.",
    opportunities: [],
  });

  assert.deepEqual(Object.keys(report).sort(), [
    "createdAt",
    "id",
    "marketSummary",
    "opportunities",
    "runId",
    "workspaceId",
  ]);
});
```

In `tests/unit/ui-hardening.test.ts`, add an environment/migration contract:

```ts
const environmentPath = new URL("../../.env.example", import.meta.url);
const migrationPath = new URL("../../drizzle/0000_vsee_postgres.sql", import.meta.url);

test("the demo has no email-provider or report-delivery configuration", async () => {
  const [environment, migration] = await Promise.all([
    readFile(environmentPath, "utf8"),
    readFile(migrationPath, "utf8"),
  ]);

  assert.doesNotMatch(
    environment,
    /RESEND_API_KEY|REPORT_FROM_EMAIL|REPORT_TO_EMAIL|REPORT_ALLOWED_RECIPIENTS/,
  );
  assert.doesNotMatch(migration, /claim_report_delivery|\\bdelivery jsonb\\b/);
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
node --import tsx --test tests/unit/intelligence-repository.test.ts tests/unit/ui-hardening.test.ts
```

Expected: the environment/migration test FAILS because Resend variables and SQL delivery state still exist.

- [ ] **Step 3: Remove application delivery code**

Delete:

```text
app/api/reports/[id]/email/route.ts
lib/email/service.ts
lib/email/templates.ts
```

Remove from `db/repositories/intelligence.ts`:

```ts
ReportDeliveryRecord
IntelligenceReportRecord.delivery
IntelligenceRepository.claimReportDelivery
IntelligenceRepository.updateReportDelivery
createMemoryIntelligenceRepository options, clock, and delivery lease
memory claim/update implementations
Supabase toReport delivery mapping
Supabase saveReport delivery payload
Supabase claim/update implementations
```

The resulting repository interface must be:

```ts
export interface IntelligenceRepository {
  saveMarketEvents(
    events: NormalizedMarketEvent[],
    workspaceId?: string,
  ): Promise<void>;
  listMarketEvents(workspaceId: string): Promise<NormalizedMarketEvent[]>;
  saveReport(report: IntelligenceReportRecord): Promise<IntelligenceReportRecord>;
  getReport(reportId: string): Promise<IntelligenceReportRecord | null>;
  listReports(workspaceId: string): Promise<IntelligenceReportRecord[]>;
}
```

Make `lib/reports/public.ts` return only:

```ts
export function toPublicReport(report: IntelligenceReportRecord) {
  return {
    id: report.id,
    workspaceId: report.workspaceId,
    runId: report.runId,
    createdAt: report.createdAt,
    marketSummary: report.marketSummary,
    opportunities: report.opportunities,
  };
}
```

Remove `delivery: jsonb("delivery")` from `db/schema.ts`.

Remove the `delivery jsonb` column, the entire `public.claim_report_delivery` function, its explicit revoke, its dynamic revoke block entry, and its service-role grant from `drizzle/0000_vsee_postgres.sql`.

Remove `isAllowedReportRecipient` from `lib/api/safety.ts`, remove its import and test from `tests/unit/api-safety.test.ts`, and keep all request-limiter behavior unchanged.

Rename the process-run integration test description from email-related wording to report-generation wording and remove only its obsolete `result.report.delivery` assertion.

- [ ] **Step 4: Remove provider configuration and update operator docs**

Remove these variables from `.env.example`:

```text
RESEND_API_KEY
REPORT_FROM_EMAIL
REPORT_TO_EMAIL
REPORT_ALLOWED_RECIPIENTS
```

Keep `XTRACE_ORG_ID` only as an optional legacy compatibility variable and document it exactly as:

```text
# Optional legacy compatibility only; current mmk_ keys do not use an Org ID.
XTRACE_ORG_ID=
```

Update `README.md` so it:

- requires `XTRACE_API_KEY` for the current demo and does not require `XTRACE_ORG_ID`;
- describes **Draft this report** as a browser-local copy action;
- contains no Resend, delivery, recipient, or real-email setup instructions;
- continues to document PostgreSQL, worker, Supabase Storage, Anthropic, market feeds, and XTrace.

- [ ] **Step 5: Run removal checks and the complete local suite**

Run:

```bash
rg -n "RESEND|REPORT_TO_EMAIL|REPORT_FROM_EMAIL|REPORT_ALLOWED_RECIPIENTS|EMAIL THIS REPORT|EMAIL SENT|claimReportDelivery|updateReportDelivery|claim_report_delivery|delivery jsonb|lib/email|reports/.*/email" app lib db worker tests drizzle .env.example README.md
```

Expected: no matches.

Run:

```bash
npm test
npm run typecheck
npm run lint
```

Expected: all tests pass; typecheck and lint exit 0.

- [ ] **Step 6: Commit**

```bash
git add -A app/api/reports lib/email tests/unit db lib/reports/public.ts lib/api/safety.ts drizzle/0000_vsee_postgres.sql tests/integration/process-run.test.ts .env.example README.md
git commit -m "refactor: remove report email delivery"
```

---

### Task 5: Live XTrace and end-to-end verification

**Files:**
- Modify only if a verified defect is found: `tests/integration/xtrace-live.test.ts`
- Modify only if a verified defect is found: implementation files covered by Tasks 1–4

**Interfaces:**
- Consumes: a Keychain-injected `XTRACE_API_KEY`, the complete application build, and the test suite.
- Produces: evidence that current `mmk_` ingest/search/delete and the full application build work without an Organization ID.

- [ ] **Step 1: Verify the live test never prints credentials**

Inspect `tests/integration/xtrace-live.test.ts` and confirm it reads credentials through `getXTraceClient()`, uses synthetic fixture content, deletes any created memory in cleanup, and never logs environment values. If any condition is false, first add a failing/static test that captures that behavior, then make the smallest correction.

- [ ] **Step 2: Run the live XTrace integration with API key only**

Run without reading or echoing the secret:

```bash
XTRACE_API_KEY="$(security find-generic-password -a "$USER" -s 'vsee-xtrace-api-key' -w)" \
XTRACE_LIVE_TEST=1 \
node --import tsx --test tests/integration/xtrace-live.test.ts
```

Expected: the live ingest/poll/search/delete test passes without `XTRACE_ORG_ID`. If XTrace is externally unavailable, record the exact HTTP status/error but do not weaken authentication or silently skip the test.

- [ ] **Step 3: Run complete verification**

Run:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Expected: all four commands exit 0.

- [ ] **Step 4: Verify the removed surface and secret hygiene**

Run:

```bash
rg -n "RESEND|REPORT_TO_EMAIL|REPORT_FROM_EMAIL|REPORT_ALLOWED_RECIPIENTS|EMAIL THIS REPORT|EMAIL SENT|claim_report_delivery|X-Org-Id" app lib db worker tests drizzle .env.example README.md
git diff --check
git status --short
```

Expected:

- no email-delivery matches;
- `X-Org-Id` appears only in the intentional legacy compatibility implementation/test, never on `mmk_`;
- `git diff --check` exits 0;
- worktree contains no unintended or secret-bearing files.

- [ ] **Step 5: Commit verified corrections only if Step 1–4 required code changes**

```bash
git add tests/integration/xtrace-live.test.ts lib/xtrace/client.ts lib/xtrace/service.ts app/report-draft-dialog.tsx app/page.tsx lib/reports/draft.ts
git commit -m "test: verify report drafting and XTrace auth"
```

If no correction was needed, do not create an empty commit.
