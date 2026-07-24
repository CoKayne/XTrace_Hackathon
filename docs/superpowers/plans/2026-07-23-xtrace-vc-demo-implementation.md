# VSee VC Deal Intelligence Implementation and Handoff Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a public Web App that scans real public information from the
latest 14 days, detects market changes first, recalls overlapping historical VC
Deals with XTrace, ranks cited Top 5 medium/high opportunities with Anthropic,
persists the report, sends it through Resend, and supports stored-data-only
Chat.

**Architecture:** A vinext App Router Web process and a separate long-running
worker share Supabase PostgreSQL. Supplied PDFs live in private Supabase
Storage. XTrace is the separate long-term memory infrastructure; Anthropic is
the separate reasoning service. All provider calls and secrets remain
server-side.

**Tech stack:** Node.js 22.13+, vinext/Vite, Next.js-compatible App Router,
React 19, TypeScript, Zod, Supabase PostgreSQL REST and private Storage, XTrace
Memory Manager HTTP API, Anthropic Messages API, Resend, Node test runner.

## Global constraints

- Public single-workspace demo; reserve `workspace_id` for later multi-user
  expansion but do not add authentication in this build.
- Fixed supplied PDF corpus is preloaded; no runtime file picker.
- Keep original source PDFs in private cloud storage and use expiring signed
  read links.
- No audio, speech recognition, Gmail, Google Drive, Slack, or Calendar.
- A manual scan fetches real public evidence dated within the latest 14 days.
- Detect and summarize market events before matching historical Deals.
- Include `screening`, `watchlist`, `evaluating`, `passed`, and `invested`.
- Keep only Top 5 medium/high opportunities.
- Always persist a truthful market summary, including a zero-match report.
- Send a real report email only to configured/allowed recipients.
- Chat uses existing stored data only and supports claims with citations.
- XTrace ON cannot silently fall back to structured OFF retrieval.
- XTrace is memory infrastructure; Anthropic is the LLM.
- Synthetic decision context always displays: “Synthetic VC decision record
  created for the hackathon demo”.
- `Pitch-combined-InterTwin-AI.pdf` remains one private source object and maps pages 1–11 to
  InterTwin.ai, UniKudo, Mirror, CouPro, IndieShow, HuMetric, Alpha Builders,
  INNFormNest, SilverMemory, Kanesh, and Fellowtrip respectively.
- In-memory persistence is test/development-only; deployed Web and worker use
  the same Supabase project.

---

## Shared interfaces to freeze before parallel work

These files are the cross-module authority:

- `lib/contracts/domain.ts`
- `lib/contracts/http.ts`
- `lib/market/types.ts`
- `docs/superpowers/specs/2026-07-23-xtrace-vc-demo-integration-design.md`

The four primary exchanged objects are:

1. `DealMemoryBundle`: one Deal's page-backed facts and labeled VC fixtures.
2. `MemoryContext`: XTrace result resolved to local Deal/source/fixture IDs.
3. `MarketEvent`: normalized current event with public evidence.
4. `OpportunityReportItem`: medium/high match with claim-level citations.

No module may pass raw provider, XTrace, or Anthropic JSON directly to another
module. Parse at the owning boundary and pass a shared contract.

## Module 1 — Web App and orchestration

**Owner files**

- `app/page.tsx`
- `app/vsee.css`
- `app/globals.css`
- `app/api/overview/route.ts`
- `app/api/deals/route.ts`
- `app/api/documents/route.ts`
- `app/api/imports/preview/route.ts`
- `app/api/imports/confirm/route.ts`
- `app/api/runs/route.ts`
- `app/api/runs/[id]/route.ts`
- `app/api/market/events/route.ts`
- `app/api/reports/route.ts`
- `app/api/reports/[id]/email/route.ts`
- `app/api/settings/health/route.ts`
- `app/api/documents/[id]/access/route.ts`
- `lib/demo/view-model.ts`
- `lib/api/safety.ts`

**Consumes**

- corpus preview from Module 2;
- persisted Deals/runs/reports/events;
- health status from database, worker, and provider configuration;
- `ChatAnswer` from Module 5.

**Produces**

- confirmed corpus selection;
- durable run request `{ workspaceId, mode, windowDays: 14 }`;
- explicit report-email request;
- existing-data Chat question.

- [ ] Confirm Sources UI calls preview first and displays detected
      company-to-Deal ownership before confirmation.
- [ ] Disable Run when durable PostgreSQL or worker readiness is absent.
- [ ] Initialize XTrace mode from actual health and display partial warnings.
- [ ] Preserve report deep links, cited PDF pages, and mobile navigation.
- [ ] Retain rate limits, accessible form labels, and recipient allowlist.

**Verification**

```bash
node --import tsx --test tests/unit/api-safety.test.ts \
  tests/unit/demo-view-model.test.ts
npm run typecheck
npm run build
```

## Module 2 — private corpus and Deal normalization

**Owner files**

- `seed/manifest.json`
- `seed/corpus/*.pdf`
- `lib/corpus/manifest.ts`
- `lib/corpus/evidence.ts`
- `lib/corpus/market-evidence.ts`
- `lib/corpus/fixtures.ts`
- `lib/corpus/service.ts`
- `lib/storage/service.ts`
- `scripts/seed-demo.ts`
- `app/api/imports/preview/route.ts`
- `app/api/imports/confirm/route.ts`

**Consumes**

- supplied immutable PDFs;
- user confirmation of company and Deal association.

**Produces**

- `SourceDocument`, signed source access, `SourceRef`;
- durable company/Deal/evidence/fixture rows;
- `DealMemoryBundle` for all 19 Deals: eight one-file Deals plus 11 page-scoped
  Deals from `Pitch-combined-InterTwin-AI.pdf`.

- [ ] Verify manifest byte size and SHA-256 before seed.
- [ ] Upload missing PDFs to a private Supabase Storage bucket.
- [ ] Persist page/excerpt provenance for all extracted facts.
- [ ] Enforce the exact synthetic fixture label in contracts and PostgreSQL.
- [x] Create 11 Deal associations from the single `Pitch-combined-InterTwin-AI.pdf` object
      and retain page 1–11 lineage through evidence, memory, matching, and UI.

**Verification**

```bash
node --import tsx --test tests/unit/corpus.test.ts \
  tests/unit/storage-service.test.ts
```

## Module 3 — XTrace memory bridge

**Owner files**

- `lib/xtrace/client.ts`
- `lib/xtrace/service.ts`
- `db/repositories/xtrace-lineage.ts`
- `worker/stages/ingest-memory.ts`
- `tests/unit/xtrace-service.test.ts`
- `tests/integration/xtrace-live.test.ts`

**Consumes**

`DealMemoryBundle`, stable workspace ID, candidate Deal IDs.

**Produces**

XTrace job/memory lineage and resolved `MemoryContext[]`.

- [ ] Submit ingest asynchronously and persist the returned job ID.
- [ ] Let the worker poll all pending/running ingest jobs with bounded retries.
- [ ] Store returned memory IDs and local source/fixture lineage.
- [ ] Resolve every recall result against allowed candidate Deal IDs and local
      provenance.
- [ ] Respect the 30 requests/minute account limit by dispatching at no more
      than 25 requests/minute.
- [ ] Mark an XTrace-mode run partial on unavailable/empty recall; do not use
      structured candidate context behind the ON state.

**Verification**

```bash
node --import tsx --test tests/unit/xtrace-service.test.ts
RUN_XTRACE_LIVE_TEST=1 node --import tsx \
  --test tests/integration/xtrace-live.test.ts
```

The live test command is run only after credentials are supplied through the
approved secret store; no secret value is printed or committed.

## Module 4 — 14-day market intelligence

**Owner files**

- `lib/market/config.ts`
- `lib/market/providers.ts`
- `lib/market/service.ts`
- `lib/market/types.ts`
- `worker/stages/market-scan.ts`
- `db/repositories/intelligence.ts`

**Consumes**

run time, 14-day window, provider configuration, four supplied market-report
baseline evidence records.

**Produces**

normalized/deduplicated `MarketEvent[]`, per-provider results/warnings, and a
truthful market summary.

- [ ] Register Federal Register, FDA, SEC, FTC, TechCrunch venture, configured
      official/publisher RSS, and optional authorized Crunchbase.
- [ ] Validate URLs and fetch only HTTP(S) sources with bounded timeouts.
- [ ] Filter by publication time inside the 14-day run window.
- [ ] Deduplicate by canonical URL/checksum before persistence.
- [ ] Isolate provider failures and preserve a market summary when truthful
      evidence remains.
- [ ] Never synthesize a recent event when live sources are empty.

**Verification**

```bash
node --import tsx --test tests/unit/market-config.test.ts \
  tests/unit/market-service.test.ts
```

## Module 5 — matching, reports, email, and Chat

**Owner files**

- `lib/matching/context.ts`
- `lib/matching/claude-reasoner.ts`
- `lib/matching/service.ts`
- `lib/email/service.ts`
- `lib/chat/service.ts`
- `app/api/chat/route.ts`
- `app/api/reports/[id]/email/route.ts`
- `worker/process-run.ts`
- `worker/runner.ts`

**Consumes**

`MarketEvent[]`, all Deal statuses, resolved `MemoryContext[]` or explicit
structured-OFF bundles, configured Anthropic and Resend credentials.

**Produces**

persisted `OpportunityReport`, delivery state, and grounded `ChatAnswer`.

- [ ] Begin with market events, then retrieve overlapping historical Deals.
- [ ] Require at least one current `public_web` source and one Deal-lineage
      source/fixture for each opportunity.
- [ ] Validate `whyNow`, `previousContext`, implications, and next step at claim
      level; reject unsupported or autonomous investment instructions.
- [ ] Filter low confidence and rank at most five.
- [ ] Persist one report with a market summary even when opportunities are
      empty.
- [ ] Send the report through Resend only to an allowed recipient and persist
      the provider message ID.
- [ ] Build Chat's final prose only from supported claims; return insufficient
      evidence when no supported claim remains.

**Verification**

```bash
node --import tsx --test tests/unit/matching.test.ts \
  tests/unit/matching-reasoner.test.ts \
  tests/unit/email-chat.test.ts \
  tests/integration/process-run.test.ts
```

## Durable database and worker gate

**Owner files**

- `drizzle/0000_vsee_postgres.sql`
- `db/schema.ts`
- `db/client.ts`
- `db/repositories/runs.ts`
- `worker/runner.ts`

- [ ] Claim jobs atomically.
- [ ] Record worker heartbeat and expose recent readiness to the Web App.
- [ ] Lease running jobs and reclaim stale leases after worker failure.
- [ ] Persist stage transitions, warnings, final report, and terminal status.
- [ ] Enable RLS on every application table without browser-facing policies.
- [ ] Revoke table/function access from `public`, `anon`, and `authenticated`.
- [ ] Grant the service role only the table privileges and queue-function
      execution it requires.
- [ ] Fix every security-definer function's `search_path`.

**Verification**

```bash
node --import tsx --test tests/integration/runs-repository.test.ts \
  tests/integration/process-run.test.ts
```

## Full integration gate

Run from the repository root after merging all five module branches:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Then run an evidence smoke test against the production build:

1. render `/` and verify the VSee shell;
2. confirm `/api/overview`, `/api/deals`, `/api/runs`, and
   `/api/settings/health` return validated success responses;
3. open a private PDF through a signed source route and verify its byte count;
4. confirm the fixed corpus and explicitly approve company/Deal associations;
5. run one structured-OFF and one XTrace-ON scan against the same 14-day
   evidence set;
6. verify ON never silently falls back;
7. inspect every opportunity citation and Demo fixture label;
8. verify a zero-match run still produces a market summary;
9. send one real allowlisted report email;
10. ask Chat a supported and unsupported question.

## Parallel merge order

1. Freeze shared contracts and this specification.
2. Modules 1–5 develop concurrently against contract fixtures.
3. Merge durable database/worker changes before connecting UI mutations.
4. Merge corpus and XTrace lineage before XTrace-ON matching.
5. Merge market providers before final matching evidence tests.
6. Merge email and Chat after report contracts are stable.
7. Run the full integration gate and independent code review.

## Fixed combined-PDF decision

The multi-company classification is resolved: do not request another product
decision and do not collapse the file into one Deal. Use the exact page mapping
in the integration specification while storing only one private PDF object.
