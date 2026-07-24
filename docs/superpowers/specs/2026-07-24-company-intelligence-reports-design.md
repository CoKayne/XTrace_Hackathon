# Company Intelligence Reports Design

## Status

Approved in product discussion on July 24, 2026.

## Goal

Replace the current Runs-first scan experience with a Second Look-style
decision-intelligence workflow. Every successful 14-day scan must produce a
durable report containing one analysis for each of the 19 fixed MVP Deals.
Medium- and high-confidence analyses may be recommended for a second look.
Every other Deal must still receive a truthful, evidence-bounded result stating
that the scan found no material reason to change the prior investment belief.

The implementation must preserve the existing black and fluorescent-green VSee
visual system while adopting the product flow and report hierarchy demonstrated
by the Second Look reference application.

## Product principles

1. A scan produces an investment report, not an engineering job identifier.
2. All 19 fixed MVP Deals are analyzed on every successful scan.
3. A missing recommendation is a valid result, not an empty product state.
4. No displayed company metric, financing term, customer claim, market event,
   or historical decision may exist without traceable evidence.
5. Missing evidence is displayed as `Not available in current evidence`.
6. XTrace is the required memory source for historical investment context in
   XTrace mode. The product does not silently substitute structured local
   memory when XTrace recall is unavailable.
7. The AI recommends human research, diligence, or follow-up. It never
   recommends committing capital or making an investment decision.

## Primary user flow

The global scan action is labeled `WAKE AGENT & SCAN MARKET`.

1. The user starts a scan from any product page.
2. The current page transitions to a scan-progress experience instead of the
   Runs page.
3. The progress experience shows the durable worker stages:
   - scanning the latest 14 days of public evidence;
   - normalizing and ranking market events;
   - synchronizing and recalling XTrace memory;
   - comparing evidence against all 19 Deals;
   - generating and persisting the report.
4. The worker creates 19 durable `CompanyAnalysis` records.
5. When the scan completes:
   - if one or more analyses are medium or high confidence, the application
     automatically opens the highest-ranked `Belief revised` result;
   - otherwise, the application opens the completed report and states that no
     investment belief materially changed.
6. The user can open the complete Company Brief for any Deal or review all 19
   results in the report.
7. Runs remain available as secondary technical diagnostics under Settings,
   rather than as the main investor workflow.

## Analysis outcomes

Every `CompanyAnalysis` has exactly one outcome:

- `belief_revised`: medium- or high-confidence evidence materially satisfies,
  contradicts, or changes a documented historical decision reason or revisit
  condition;
- `monitor`: relevant evidence exists, but it is not strong enough to justify a
  belief change or immediate follow-up;
- `no_material_change`: no sufficiently relevant market evidence matched the
  Deal during this scan;
- `analysis_unavailable`: the company could not be analyzed because a required
  dependency or per-company reasoning operation failed.

Only `belief_revised` analyses qualify for the recommended second-look ranking.
`monitor` and `no_material_change` analyses remain visible in the report and
company history.

## Company analysis contract

Each analysis stores and returns the following fields.

### Identity and result

- Report ID
- Run ID
- Deal ID
- Company name
- Deal status
- Analysis outcome
- Confidence: `low`, `medium`, or `high`
- Bounded score from 0 to 1
- Analysis timestamp
- Number of verified source references

### Then / Investment Memory

- Previous meeting summary
- Decision reason
- Partner concerns
- Revisit conditions
- Last evaluated time, when present in evidence
- Resolved XTrace memory identifiers
- Source-document and synthetic-fixture lineage

Synthetic VC decision records remain visibly labeled as hackathon demo
fixtures. They may represent internal historical context but may not be
presented as external company facts.

### Now / Market Evidence

- Matched market-event identifiers
- Event title and event type
- Publication timestamp
- Evidence-backed explanation of why the event may affect the company
- Determination of whether the event satisfies, contradicts, or does not
  materially affect the historical decision context
- Positive implications
- Negative implications
- Public source references

When no material public evidence matches, the analysis displays:

> No material market evidence matched this company during the current 14-day scan.

### Recommended next move

Medium- and high-confidence `belief_revised` analyses receive a safe,
application-owned human follow-up action appropriate to the current Deal
status. Low-confidence and unchanged analyses display:

> No immediate follow-up recommended. Continue monitoring.

The model cannot supply an arbitrary action, outbound recipient, investment
instruction, or capital-commitment recommendation.

### Company Brief sections

The Company Brief contains:

- IC Snapshot
- Traction
- Deal Terms
- Risks
- Decision History
- Source Lineage

These sections are sparse evidence views, not fields the model is required to
fill. ARR, growth, customers, margins, financing amounts, valuations, round
terms, ownership targets, dates, and risks appear only when supported by a
source. Every unsupported field renders `Not available in current evidence`.

### Internal report draft

Medium- and high-confidence analyses may create an editable internal VC draft
containing:

- subject;
- why the company deserves another look now;
- the prior investment decision context;
- the evidence that changed or satisfied a condition;
- remaining risks or unanswered questions;
- the recommended human next step;
- source citations.

The draft has no recipient, does not send email, and preserves the existing
copy-to-clipboard workflow.

## Report contract

One `IntelligenceReport` belongs to one scan Run and contains:

- Report ID
- Run ID
- Workspace ID
- Creation timestamp
- Market summary
- Evidence-coverage summary
- Total company count, fixed at 19 for the MVP corpus
- Counts by analysis outcome
- Priority Deal ID when a recommended result exists
- Report completion status
- All 19 company analyses

The report summary may describe how many public items were accepted, excluded
as non-signals, or omitted by bounded ranking. Normal evidence bounding is an
informational statement and does not mark the Run partial.

## Persistence design

### `intelligence_reports`

Extend the durable report representation with:

- `analysis_status`
- `company_count`
- `belief_revised_count`
- `monitor_count`
- `no_material_change_count`
- `analysis_unavailable_count`
- `priority_deal_id`, nullable
- `evidence_coverage`, JSON

Keep the existing report identity, run relationship, timestamp, market summary,
and legacy opportunities JSON during the compatibility period.

### `company_analyses`

Add a durable table keyed by report and Deal:

- `id`
- `workspace_id`
- `report_id`
- `run_id`
- `deal_id`
- `company_name`
- `deal_status`
- `outcome`
- `confidence`
- `score`
- `investment_memory`, JSON
- `market_evidence`, JSON
- `implications`, JSON
- `recommended_next_move`
- `company_brief`, JSON
- `source_refs`, JSON
- `created_at`

The database enforces one row per `(report_id, deal_id)`. A Deal can have many
analyses across different reports, creating a longitudinal decision history.

### Backward compatibility

- Existing report rows remain readable.
- Existing `opportunities` are interpreted as recommended company results when
  no `company_analyses` rows exist.
- New medium- and high-confidence recommended analyses continue to generate the
  legacy public opportunities projection while downstream Chat and Draft
  migrate to the new durable analysis contract.
- Existing report URLs remain valid.

## Worker and reasoning architecture

### Stage 1: Market scan

Scan the configured eight-source public mix for the latest 14 days. Normalize,
deduplicate, classify, and rank source-backed events. Persist all accepted
events while bounding the event set passed to XTrace and Opus.

### Stage 2: XTrace memory recall

Synchronize pending Deal-memory ingest jobs. Recall historical memory for each
of the 19 Deals using a bounded, company-specific query. Each request stays
within the XTrace 4,000-character query boundary and the existing distributed
rate limiter. Resolve every recalled memory to the requested local Deal and its
source lineage. A global market query may narrow likely matches, but it cannot
replace the per-Deal recall required to populate all 19 Investment Memory
sections.

XTrace recall failure in XTrace mode produces an incomplete report rather than
a local structured-memory fallback. A Deal whose required memory recall fails
receives `analysis_unavailable`; other Deals continue when their memory recall
succeeds.

### Stage 3: Candidate evidence preparation

Build a per-Deal evidence package for each of the 19 Deals:

- Deal identity and status;
- resolved historical memory;
- source-document and fixture lineage;
- potentially relevant ranked market events;
- allowed source catalog.

The candidate-selection layer may use deterministic token, entity, sector,
theme, decision-reason, concern, and revisit-condition overlap. Candidate
selection never becomes a displayed claim.

### Stage 4: Per-company analysis

Every Deal receives a result.

- Deals with credible candidate evidence are sent to the evidence-constrained
  Opus reasoner.
- Grounding validation rejects claims not copied from or directly supported by
  the cited excerpts.
- Deals without credible candidate evidence receive a deterministic
  `no_material_change` analysis.
- A per-company model or validation failure becomes `analysis_unavailable`;
  processing continues for the remaining Deals.

### Stage 5: Ranking and report persistence

Rank only medium- and high-confidence `belief_revised` analyses. Persist the
report and all 19 analyses atomically from the product's perspective. Select the
highest-ranked recommended Deal as `priority_deal_id`.

The Run is:

- `completed` when every required stage completes and all dependency coverage
  is valid, even when no Deal is recommended;
- `partial` when at least one source provider or company analysis fails but a
  report can still be produced;
- `failed` when required market evidence, durable persistence, or the report
  itself cannot be produced.

## API design

### Existing endpoints

- `POST /api/runs` creates or reuses a durable scan.
- `GET /api/runs/:id` supplies progress and diagnostics.
- `GET /api/reports` supplies report summaries.
- `GET /api/reports/:id` supplies the complete report.

### New endpoints

- `GET /api/reports/:id/companies/:dealId` returns one Company Brief from the
  specified report.
- `GET /api/deals/:id/analyses` returns that Deal's longitudinal scan history.

Public serializers remove internal diagnostics, malformed legacy data, and any
unsupported model output.

## User interface design

### Overview

Display Agent readiness, the latest scan summary, and the highest-priority
result. When no result qualifies, display the completed analysis count and the
truthful no-change conclusion.

### Scan progress

Display the durable Run stage without exposing the Run UUID as the primary
content. Poll the Run endpoint. When the Run becomes terminal, fetch and open
its associated report automatically.

### Priority Result

Use the Second Look information hierarchy:

1. company identity and current Deal state;
2. Then / Investment Memory;
3. the belief-change relationship;
4. Now / Market Evidence;
5. confidence and evidence coverage;
6. Recommended next move;
7. actions to inspect evidence, draft the internal report, or open the full
   Company Brief.

### Reports

Each report displays:

- scan date and market summary;
- outcome counts;
- evidence coverage;
- all 19 company analyses;
- filters for outcome, Deal status, and confidence;
- medium/high belief changes first, followed by monitor, unchanged, and
  unavailable results.

### Company Brief

Provide the IC Snapshot, Traction, Deal Terms, Risks, Decision History, and
Source Lineage tabs. Every missing evidence field uses the approved unavailable
label.

### Deals

Retain all fixed corpus Deal records. Add the latest Company Brief and the
company's previous scan analyses without removing the existing source and
synthetic-context labels.

### Runs / System activity

Move Runs to a secondary `System activity` area under Settings. Preserve Run
IDs, worker stages, warnings, and error details for diagnostics. Investor-facing
navigation does not use the Run UUID as report content.

## Evidence and safety rules

1. Public market facts require `public_web` sources.
2. Historical source facts require `source_document` sources.
3. Synthetic internal decisions require visibly labeled `demo_fixture`
   lineage.
4. `model_inference` may explain a bounded relationship but cannot establish a
   company fact.
5. XTrace text never outranks its resolved local source excerpt.
6. Every displayed claim retains source IDs through persistence, API
   serialization, Chat, Draft, and UI rendering.
7. Missing evidence produces an unavailable or no-change result, not model
   completion.
8. Recommendations remain human review actions.

## Error handling

- A partial market-provider failure creates an evidence-coverage warning and
  uses only successful sources.
- A total market-provider failure prevents company recommendations.
- An XTrace recall failure in XTrace mode marks historical context unavailable
  and prevents false structured fallback.
- Opus JSON or schema validation receives one bounded repair attempt.
- A per-company analysis failure records `analysis_unavailable` and allows the
  other Deals to finish.
- A report persistence failure fails the Run.
- Durable System activity stores sanitized provider and stage error details.
- The UI distinguishes incomplete evidence from an unchanged market belief.

## Test and acceptance criteria

### Contracts and persistence

- A successful MVP scan persists exactly 19 company analyses.
- The database rejects duplicate `(report_id, deal_id)` rows.
- Every analysis outcome validates against the contract.
- Sparse Company Brief sections preserve explicit unavailable fields.
- Existing report migrations retain legacy rows and URLs.

### Grounding and reasoning

- Unsupported financial, traction, financing, customer, or risk claims are
  removed.
- A no-candidate Deal receives `no_material_change` without an Opus invention.
- Medium/high recommendation ranking includes only grounded
  `belief_revised` analyses.
- XTrace failure never uses implicit structured fallback.
- Public claims and historical claims resolve to their correct provenance.

### Worker

- The worker processes all 19 Deals even when one company analysis fails.
- Normal event ranking does not make the Run partial.
- Per-company failures create `analysis_unavailable`.
- A no-recommendation scan still completes with a full report.

### APIs and UI

- Scan progress follows durable stages.
- A completed scan automatically opens its report.
- A qualifying scan opens the priority result.
- A zero-recommendation scan presents the explicit no-change conclusion.
- Reports display and filter all 19 analyses.
- Company Brief tabs never display unsupported values.
- Runs are available through System activity without being the main workflow.
- Chat and Draft use the same persisted CompanyAnalysis lineage.

### Verification

Before completion:

- run the complete unit and integration suite;
- run type checking and linting;
- build the production artifact;
- run the live XTrace bridge;
- execute a real 14-day scan against the configured sources;
- verify 19 durable company results and a terminal completed or truthfully
  partial report;
- deploy the exact verified commit;
- verify production health, report APIs, priority-result navigation, Company
  Brief rendering, and source links.
