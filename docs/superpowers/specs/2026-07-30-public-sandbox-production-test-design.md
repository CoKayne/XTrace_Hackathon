# Public Sandbox Production Test Design

**Date:** 2026-07-30  
**Status:** Approved for implementation  
**Target:** Existing VSee Sites project and production URL

## 1. Objective

Turn the existing anonymous, read-only VSee deployment into an anonymous,
writable product-testing sandbox where the owner can exercise every implemented
workflow end to end:

1. upload and confirm private test sources;
2. inspect and change the active Fund Policy;
3. run a manual 14-day market scan with or without XTrace;
4. wait for the durable background Worker;
5. inspect complete matching and source-grounded underwriting reports;
6. inspect, edit, copy, download, and save latest-only action drafts; and
7. reset the visible test workspace before another run.

This is a live production deployment for product testing, but it is not a
secure customer production environment. It must visibly identify itself as a
public test sandbox and instruct users not to upload confidential or real
customer data.

## 2. Deployment Modes

The application retains three explicit modes:

- `public_demo`: anonymous, synthetic, read-only showcase.
- `public_sandbox`: anonymous, single-workspace, writable product-testing
  environment.
- `product`: Sites-authenticated, membership-authorized customer environment.

`public_sandbox` must not weaken or bypass `product` authorization. It resolves
only the configured sandbox workspace, uses a stable non-human sandbox actor
identifier for audit fields, and never accepts a browser-supplied workspace ID.

The existing Sites URL remains public and is deployed with
`VSEE_DEPLOYMENT_MODE=public_sandbox`. A persistent banner states:

> PUBLIC TEST SANDBOX — Do not upload confidential or real customer data.

## 3. Public Sandbox Capabilities

`public_sandbox` enables:

- manual scan creation;
- source upload;
- company and Deal confirmation;
- private test-source access through short-lived signed URLs;
- Fund Policy management;
- current-body action-draft saving; and
- safe test-view reset.

It retains:

- server-only Supabase, Anthropic, XTrace, and Storage credentials;
- server-resolved `DEMO_WORKSPACE_ID`;
- upload, scan, reset, chat, and signed-source rate limits;
- one active scan per workspace;
- exact Source Revision and Deal lineage;
- append-only Fund Policy versions;
- immutable underwriting artifacts; and
- draft-only external actions.

The sandbox does not send Email/SMS, publish LinkedIn content, approve
investments, or execute financial transactions.

## 4. Safe Reset Semantics

Reset means **start a clean testing view**, not delete the investment audit
trail.

### 4.1 Reset behavior

Reset hides pre-reset terminal runs, market events, intelligence reports, and
company-analysis results from the default Overview, Market, Reports, and
Settings lists. A new scan begins a clean visible generation.

Reset never deletes:

- companies or Deals;
- uploaded objects, documents, source revisions, assignments, or evidence;
- XTrace ingest jobs, lineage, links, or remote memories;
- Fund Policy versions or the active pointer;
- reasoner-judgment replay cache;
- framework, benchmark, router, valuation, or decision references;
- underwriting batches, candidate runs, checkpoints, Evidence Packs,
  framework judgments, narratives, calculations, decisions, or action drafts;
- queued or running work.

Direct immutable historical report links may remain readable for audit, while
default lists show only the current test generation.

### 4.2 Implementation shape

A new workspace-scoped reset marker records `reset_at`. Mutable read models use
that marker:

- reports and terminal runs filter by `created_at > reset_at`;
- market events gain an observation timestamp and filter by
  `observed_at > reset_at`;
- rescanning an existing public event refreshes its observation timestamp.

The reset endpoint:

1. resolves only the configured sandbox workspace;
2. refuses with HTTP 409 while a scan is queued or running;
3. records the marker atomically through a controlled PostgreSQL RPC;
4. clears focused report/progress state and report query parameters in the UI;
5. reloads the clean current-generation views.

The top-bar control reads `RESET TEST VIEW`, opens a confirmation dialog that
states exactly what is and is not affected, and is rate-limited.

## 5. Runtime Upload Formats

The exact runtime allowlist becomes:

| Extension | Content type | Extraction |
|---|---|---|
| `.txt` | `text/plain` | strict UTF-8 text |
| `.md` | `text/markdown` | strict UTF-8 text |
| `.docx` | Office Open XML document | `mammoth` raw text |
| `.pdf` | `application/pdf` | `unpdf`, page by page |
| `.png` | `image/png` | Anthropic vision transcription |
| `.webp` | `image/webp` | Anthropic vision transcription |

Explicitly rejected:

- `.jpg` and `.jpeg`;
- `.gif`;
- audio and video;
- legacy `.doc`;
- password-protected, malformed, or unreadable PDF/DOCX files.

The existing 12 MiB per-file limit remains for this test release.

### 5.1 File verification

The server validates extension, resolved MIME type, and file signature instead
of trusting only the browser-reported MIME type. DOCX validation confirms an
Office ZIP container and applies decompression-size/file-count limits. PDF
validation confirms the PDF signature and bounded page count before extraction.

### 5.2 Evidence fidelity

- Text-layer PDF extraction retains each page separately.
- Exact PDF excerpts produce `pdf_page` locators with the real one-based page.
- DOCX/TXT/Markdown excerpts retain exact text-range locators.
- PNG/WebP model transcription remains model-derived and cannot be presented
  as a byte-exact quotation.
- Image-only/scanned PDFs that have no trustworthy text layer fail honestly in
  this release instead of promoting model OCR as exact evidence.
- Extraction is chunked without the prior silent 40,000-character truncation.
  Coverage and any explicit limits are recorded.

The PDF/DOCX parsers are dynamically loaded only by the Node Worker and must not
enter the Sites/Cloudflare Web bundle.

## 6. Source Confirmation and Memory

All uploads remain staged until the user confirms:

- company name;
- existing or new Deal;
- Deal status; and
- source ownership.

Only confirmation may create the durable Deal/Source Revision/evidence
lineage and queue XTrace ingestion. Upload and extraction alone never change
Deal state or XTrace memory.

## 7. Worker and Full Analysis

The Sites Web and long-running Worker remain separate processes. Both use the
same Supabase project, exact source commit, Anthropic model, XTrace
configuration, market providers, framework catalog, and migrations.

The Worker processes:

1. uploaded-document extraction;
2. confirmed-source XTrace ingestion;
3. 14-day public-market collection and normalization;
4. XTrace/structured historical recall;
5. all-Deal matching and ranking;
6. Top-5 source-grounded underwriting;
7. framework lenses, Bear/Base/Bull valuation, deterministic decision policy;
8. report and latest-only action-draft persistence.

The Web may create a scan only after a fresh Worker heartbeat is visible.

## 8. Report Acceptance

The testing release is accepted only when a real manual scan produces a report
that can be inspected in the UI, including:

- what happened and cited market evidence;
- historical investment memory and the previous decision;
- positive and negative implications;
- each selected core/advisory framework's public rationale, evidence,
  counterevidence, unknowns, and disagreements;
- Bear/Base/Bull valuation where the context and source facts support it;
- Ask-price comparison, ownership, MOIC, IRR, Company Quality, Price
  Attractiveness, and Fund Fit;
- missing evidence, blockers, decision ceiling, and source lineage;
- formal `Pass`, `Watch`, `Advance`, or `Invest Candidate` result; and
- internal report, Email, SMS, LinkedIn, memo, and diligence-request drafts
  without external delivery.

`Invest Candidate` remains an invitation to human IC review, never an automatic
investment approval.

## 9. Audio: Preserved but Deferred

Audio is not added to the runtime allowlist, routes, dependencies, Worker, or
UI in this release.

A dedicated deferred specification preserves the previous full concept for
future work:

- browser recording and direct file upload;
- recordings up to two hours;
- primarily English with occasional Chinese;
- Apple Silicon/local Whisper exploration from the earlier desktop design;
- a future Web-compatible asynchronous transcription job;
- speaker/timestamp lineage;
- consent, privacy, retention, and deletion controls;
- transcript preview and human company/Deal confirmation before promotion;
- no Deal or XTrace mutation before confirmation.

The existing private `Fetter Family Cafe.m4a` research recording remains
untracked and must never be committed as a product fixture.

## 10. Production Cutover

Cutover order:

1. add regression tests before each behavior change;
2. add the reset-marker migration after the existing migration chain;
3. implement safe Reset and the `public_sandbox` mode;
4. implement and verify the exact upload allowlist and parsers;
5. preserve the deferred audio specification;
6. apply the first missing remote Supabase migration through the new migration
   without gaps;
7. seed/verify the fixed corpus and immutable underwriting references;
8. start a Worker from the exact deploy commit and verify its heartbeat;
9. set Sites to `public_sandbox`, retain public access, save a new version, and
   deploy it to the existing URL;
10. run signed-source, upload/confirm, structured scan, XTrace scan, Reset,
    Fund Policy, full report, Chat/Search, and action-draft acceptance tests.

If cutover fails, stop the Worker, restore the previous `public_demo`
environment and known Sites version, and retain forward database migrations.

## 11. Required Verification

- focused red/green tests for Reset, capabilities, authorization mode, upload
  formats, signatures, PDF pages, DOCX extraction, and source confirmation;
- complete unit/integration suite;
- full PostgreSQL migration suite from `0000` through the new migration;
- TypeScript, lint, and production build;
- Docker/Node Worker smoke and heartbeat;
- Web bundle check proving PDF/DOCX parser packages are absent;
- live API checks for Fund Policy, health, uploads, run creation/progress,
  reports, source links, drafts, and reset;
- one complete real report inspected for structure, evidence, calculations,
  framework output, and missing-data honesty.

