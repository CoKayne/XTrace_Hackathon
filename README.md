# VSee — VC Decision Intelligence

VSee is a public, single-workspace Hackathon Web App that connects recent
public-market evidence with previously reviewed venture Deals. XTrace supplies
long-term Deal-memory recall; Anthropic performs evidence-constrained matching.

The product does not claim that a matched company has improved. It gives the
investor a cited reason to perform a second look.

## Product flow

1. Confirm the fixed private source corpus.
2. Extract source-backed Deal facts and explicitly labeled synthetic VC
   decision records.
3. Ingest eligible Deal memory into XTrace.
4. Manually queue a scan of public information published in the latest 14 days.
5. The background worker normalizes and deduplicates public evidence, recalls
   relevant Deal context, asks Claude to match the two sides, and retains only
   the Top 5 medium/high-confidence results.
6. Persist an intelligence report, then use **Draft this report** to prepare
   and copy an editable browser-local subject and message without sending it.
7. Use Chat to query only data already stored in VSee; Chat never browses or
   mutates Deal state.

## Runtime architecture

- Web: Next.js-compatible App Router built with vinext
- Persistence: Supabase PostgreSQL REST API
- Private source files: private Supabase Storage bucket
- Background work: durable PostgreSQL queue plus `npm run worker`
- Memory: XTrace Memory Manager
- Reasoning: Anthropic Messages API
- Market sources: Federal Register, FDA, SEC, FTC, TechCrunch venture,
  configured official/stable RSS feeds, and optional authorized Crunchbase API

When Supabase is not configured, the app uses process-local memory and bundled
PDFs for tests. That fallback is not shared between the Web process and the
background worker and is not suitable for a deployed demo.

## Fixed MVP corpus

The repository contains exactly:

- 9 supplied pitch-deck files
- 4 supplied market reports
- 1 reference-only VC Brain document

The nine pitch-deck files produce 19 Deal records. Eight files map one-to-one to
Deals. `Pitch-combined-InterTwin-AI.pdf` remains one private source object but maps its 11
pages to 11 page-scoped Deals: InterTwin.ai, UniKudo, Mirror, CouPro, IndieShow,
HuMetric, Alpha Builders, INNFormNest, SilverMemory, Kanesh, and Fellowtrip.
Every fact, memory bundle, match, and source link from that PDF must retain the
correct page number.

The source PDFs are real supplied artifacts. The internal investment-state
records are sample data and permanently display:

> Sample decision record

Never remove or obscure that label.

The Deals view may additionally show fabricated traction and deal-term
figures for a company. That block permanently displays the label
`Sample deal profile`, is presentation-only, and never enters memory
bundles, XTrace, recall queries, or matching input (a regression test
pins this).

The fixed corpus is the demo's initial private knowledge base. It does not
replace the live market scan: every manual run still collects public evidence
published in the latest 14 days.

## Setup

Requirements:

- Node.js 22.13 or newer
- a Supabase project and private Storage bucket
- a server-side `XTRACE_API_KEY` and Anthropic credentials
- optional authorized Crunchbase credentials

Copy `.env.example` to a local ignored environment file and configure the
server-only values. Do not expose service keys through `NEXT_PUBLIC_*`.

Apply [`drizzle/0000_vsee_postgres.sql`](drizzle/0000_vsee_postgres.sql), then
apply [`drizzle/0001_remove_report_delivery.sql`](drizzle/0001_remove_report_delivery.sql),
then [`drizzle/0002_durable_decision_lineage.sql`](drizzle/0002_durable_decision_lineage.sql),
then [`drizzle/0003_sanitize_report_next_steps.sql`](drizzle/0003_sanitize_report_next_steps.sql),
then [`drizzle/0004_company_analyses.sql`](drizzle/0004_company_analyses.sql),
then [`drizzle/0005_sample_decision_label.sql`](drizzle/0005_sample_decision_label.sql),
then [`drizzle/0006_reasoner_judgments.sql`](drizzle/0006_reasoner_judgments.sql)
to the Supabase PostgreSQL database before seeding the fixed corpus. Operators
upgrading a database that already has earlier migrations applied may apply the
missing migrations in order. Company intelligence reports require `0004`;
without it every report read fails.

```bash
npm install
npm run db:seed
```

Start the Web App and worker as separate processes:

```bash
npm run dev
npm run worker
```

The worker and Web App must receive the same Supabase, XTrace, Anthropic, and
market-source environment variables.

### Deterministic judgment replay

Claude Opus 4.8 exposes no sampling controls, so identical evidence would
otherwise produce slightly different scores on every scan. The worker stores
each matching judgment in `reasoner_judgments`, keyed by a fingerprint of the
full evidence input (deal bundles, selected market events, recalled memory,
source catalog, prompt, and model). While the evidence window is unchanged,
repeated scans replay the stored judgment and produce identical reports; new
evidence changes the fingerprint and triggers a fresh judgment. Set
`REASONER_JUDGMENT_REFRESH=1` on the worker to bypass replay and overwrite the
stored judgment.

### Production worker container

The repository includes a vendor-neutral, single-process Worker image. It does
not contain credentials and does not require a platform-specific runtime.

Build and start it with an ignored environment file:

```bash
docker build -f Dockerfile.worker -t vsee-worker .
docker run --rm --name vsee-worker --env-file .env.worker vsee-worker
```

The minimum production variables are `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, and `ANTHROPIC_API_KEY`. XTrace-mode scans also
require `XTRACE_API_KEY`; current `mmk_` keys do not require
`XTRACE_ORG_ID`. Market-feed variables remain optional according to the
features being demonstrated. Set a unique `WORKER_ID` when running more than
one replica; otherwise the runtime derives one from the container hostname and
process ID.

The process writes a non-secret liveness marker only after its PostgreSQL
heartbeat succeeds. Docker checks that marker every 30 seconds:

```bash
docker inspect --format '{{json .State.Health}}' vsee-worker
docker exec vsee-worker npm run worker:health
```

`WORKER_HEALTH_FILE` and `WORKER_HEALTH_MAX_AGE_MS` may be overridden, but the
default 60-second freshness budget should remain longer than the 15-second
worker heartbeat.

### Worker runbook

1. For a new database, apply migrations `0000` through `0006` in order; for an
   existing database, apply the migrations it is missing in order. Then seed
   the corpus before starting the Worker.
2. Start the Worker and wait for the container health status to become
   `healthy`.
3. Confirm `/api/settings/health` reports both `postgres: true` and
   `worker: true`.
4. Queue the manual 14-day scan only after both checks pass.
5. Inspect `docker logs vsee-worker` when health becomes stale. Check database
   connectivity and the `worker_heartbeats` table before restarting.
6. Restarting is safe for queued work: PostgreSQL leases allow stale running
   jobs to be reclaimed. Use a unique `WORKER_ID` for every simultaneous
   replica.

Scan creation fails closed: if the Web process cannot verify a fresh Worker
heartbeat, `POST /api/runs` returns retryable HTTP 503 and does not enqueue a
job. This prevents a Web-only deployment from accumulating stranded scans.

## Security model

The browser never receives the Supabase service-role key, XTrace key,
Anthropic key, or private object-storage credentials. All database tables use
row-level security with no browser-facing policies; only server-side code
using the Supabase service role may read or mutate them. Source files stay in
a private bucket and are opened through short-lived signed URLs.

Because this is a public single-workspace demo, POST endpoints must also retain
their server-side rate limits. Public access to the Web App is not public
access to PostgreSQL or Storage.

## Market-source configuration

`MARKET_USER_AGENT` should identify the application and include a monitored
contact address. Extra feeds are JSON arrays:

```json
[
  {
    "id": "example-vc",
    "name": "Example VC announcements",
    "url": "https://example.com/feed.xml",
    "publisher": "Example VC",
    "eventType": "funding",
    "confidence": "medium"
  }
]
```

Set this JSON in `MARKET_OFFICIAL_FEEDS_JSON` or
`MARKET_PUBLISHER_FEEDS_JSON`. Crunchbase is registered only when an authorized
`CRUNCHBASE_API_KEY` is present.

## Verification

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

The opt-in live XTrace test runs only when its test flag and credentials are
present. Unit tests never make live provider requests.

## Deployment note

The Web App and long-running queue worker are separate deployable processes.
The Web deployment alone can enqueue jobs, but a continuously running
`npm run worker` process is required to claim and finish them. Both processes
share state through Supabase PostgreSQL.
