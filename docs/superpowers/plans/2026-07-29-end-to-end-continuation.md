# XTrace VC Underwriting — End-to-End Continuation Plan

## Goal

Finish the current product as one real, source-grounded workflow:

1. ingest confirmed deal/source data;
2. preserve exact XTrace/source lineage;
3. detect recent market events;
4. match affected historical deals;
5. run source-grounded underwriting through the approved core and advisory framework catalog;
6. persist and expose reports, search, and latest-only action drafts;
7. connect the existing frontend without materially redesigning it;
8. verify the full PostgreSQL, worker, API, UI, and browser path.

## Global constraints

- Work from `feat/backend-integration-checkpoint`; never modify `main` directly.
- Preserve existing source IDs, source-revision IDs, evidence IDs, deal IDs, and organization scope. Never infer an identity from display text.
- Every investment claim, framework judgment, disagreement, recommendation, and action draft must retain source citations and visible reasoning. Do not expose hidden/private chain-of-thought.
- The named-investor framework catalog is advisory: each approved framework produces its own sourced judgment and disagreements, while formal decision weight remains zero.
- Framework selection is context-aware by stage, business model, geography, and security type. Its catalog fingerprint/corpus digest participates in replay invalidation.
- Baseline provider budget must support 8 core plus up to 20 advisory executions: at least 28 calls and 112,000 reserved tokens before retry truncation.
- When XTrace lineage includes explicit source-revision IDs, validate those exact active deal revisions and validate source IDs as their source/document IDs. Only legacy lineage without revision IDs may interpret source IDs as evidence IDs.
- Missing structured evidence must produce an explicit insufficiency/confirmation result; never infer PMF or financial facts from generic prose.
- Action drafts use latest-only persistence. Editing replaces the current body in the same draft; no original/version history is retained. Immutable identity, audience, channel, deal/candidate association, and source lineage cannot be changed.
- Public demo mode remains read-only and synthetic. Mutating product routes require a trusted product-mode session.
- Uploaded source files and extracted/canonical data remain accessible through private cloud storage for source review.
- Chat/Search query existing persisted data only. They do not browse, recalculate underwriting, mutate state, or create actions.
- Use TDD for every behavior change and independently review each task before integration.

## Task 1 — Context-aware framework execution

- Build/load the research framework catalog only after deal context is resolved.
- Cache exact catalog/service instances by stage, business model, geography, security type, and catalog version.
- Include catalog fingerprint and corpus digest in framework-stage, candidate, and persisted version fingerprints.
- Raise default provider budget to the stated baseline and prove a full core+advisory run can complete.
- Preserve authorization, exact catalog object identity, concurrency, abort, retry, usage accounting, and formal decision weight zero.

## Task 2 — Canonical source/evidence bridge and XTrace lineage

- Reconcile confirmed upload records with canonical `SourceEvidenceInput` records used by evidence packs.
- Preserve exact source/document ID plus revision ID tuples.
- Implement the explicit-revision XTrace validation semantics in Global constraints, retaining the legacy fallback only for old lineage.
- Confirmed source data with complete structured fields must be available to underwriting; incomplete generic prose must remain insufficient.
- Add memory and PostgreSQL integration tests, including migration 0012→0013 in order.

## Task 3 — Read APIs and latest-only action drafts

- Add report underwriting detail, report batch summary, search, upload listing/recovery, and action-draft list/update APIs.
- Make action-draft body replacement a controlled database operation that cannot mutate identity or lineage.
- Make all APIs organization-scoped, product-mode authenticated, and public-demo read-only.
- Return stable DTOs that support refresh/recovery, including deal and source-revision IDs for terminal uploads.

## Task 4 — Frontend integration

- Retain the existing visual design while replacing demo-only reads with real APIs in product mode.
- Wire overview, deals, report detail, framework judgments/disagreements, citations, search/chat, uploads, Fund Policy, and draft editing.
- Keep public demo data available in explicit demo mode only.
- Disable or replace unsafe reset behavior.

## Task 5 — Packaging, deployment, and acceptance

- Update migrations, worker/runtime packaging, seed/research artifacts, Docker/hosting configuration, and environment documentation.
- Run complete unit/integration suites, TypeScript, lint, migration checks, and real PostgreSQL tests.
- Exercise one browser workflow from confirmed source through report, citations, search, and saved action draft.
- Record remaining non-blocking hardening items in the technical-debt document.
