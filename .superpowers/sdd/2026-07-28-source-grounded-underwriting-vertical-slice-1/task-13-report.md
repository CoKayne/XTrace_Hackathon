# Task 13 Report — Top-5 source-grounded underwriting orchestration

## Status

`DONE_WITH_CONCERNS`

Implementation branch: `feat/task13-orchestrator`

Base: `2b6623a7e64b16006fe65c6da247f067ebdb3bf5`

## Delivered

- Added `lib/underwriting/orchestrator.ts`.
  - Keeps every eligible Deal in the batch selection ledger.
  - Selects only medium/high-confidence `belief_revised` analyses.
  - Applies a deterministic score/deal-ID ordering and a hard maximum of five.
  - Saves rank-six-and-below as `not_selected`, with an explicit truncation
    warning that says it is neither negative evidence nor `Pass`.
  - Creates/reuses ordinary batches by an immutable input fingerprint.
  - Includes exact Deal revisions, market/report input, CompanyAnalysis
    outcome/score, XTrace memory/source/fixture lineage, Fund Policy, and the
    selection policy version in the batch fingerprint.
  - Creates `force_refresh` batches and CandidateRuns with `rerun_of_id`
    lineage.
  - Runs candidates with explicit one-at-a-time bounded concurrency, a
    30-second candidate-stage timeout, two-attempt retry budget, 120-second
    lease, and five-unit cost-budget contract.
  - Contains candidate failures, preserves earlier atomic completions, and
    derives completed/partial/failed batch status without leaking provider
    diagnostics.
  - Keeps the Task 11 lens service behind `FrameworkLensService`, so the
    pending Task11b research-pack implementation can replace the synthetic
    provider without changing selection, valuation, decision, or
    finalization.
  - Executes the current candidate artifact chain:
    Evidence Pack → Context Router → deterministic valuation/scenarios →
    Task 11 synthetic framework lenses → disagreements → deterministic
    decision → narrative → five ActionDraft records → atomic finalization.
  - Generates only ActionDraft records for email, SMS, LinkedIn,
    internal memo, and DD request. There is no sender, publisher, delivery
    ID, or delivery timestamp path.

- Updated `worker/process-run.ts`.
  - Removed caller-supplied `bundles` and snapshot fingerprint inputs.
  - Loads the workspace-scoped DealRegistry snapshot only after the import
    gate succeeds.
  - Reads the before/after eligible snapshot, bundles, and exact registered
    Deal revisions inside the consuming process; rejects torn reads before
    market work starts.
  - Uses one local structured-cloned snapshot for portfolio matching,
    structured/XTrace recall, CompanyAnalysis cardinality, report snapshot
    identity, and underwriting selection.
  - Preserves every legacy market/report stage and saves the legacy report
    before starting the appended underwriting stage.
  - Underwriting failure leaves the existing report available and marks the
    scan partial instead of replacing or rolling back the legacy output.

- Updated `worker/runner.ts`.
  - Removed preloading and snapshot assembly from the runner.
  - Passes the DealRegistry itself to `processClaimedRun`.
  - Wires the persistent underwriting-run repository, active Fund Policy,
    Task 11 synthetic lens service, deterministic candidate executor, and
    existing Claude client.
  - Keeps the fixed manifest confined to seed/backfill/import-gate behavior.

- Added/updated integration coverage.
  - Top-5 selection and all-Deal `not_selected` persistence.
  - Rank six is not a CandidateRun or `Pass`; truncation is visible.
  - Ordinary batch/candidate replay.
  - XTrace source-lineage fingerprint sensitivity.
  - Force-refresh batch and CandidateRun lineage.
  - Candidate partial failure after an earlier successful finalization.
  - Full artifact-chain finalization and draft-only communication channels.
  - A real memory DealRegistry confirmation for a runtime uploaded Deal,
    proving that it receives CompanyAnalysis and enters ranking/underwriting.
  - One-Deal XTrace recall failure remains visible while underwriting still
    receives one CompanyAnalysis per eligible Deal.
  - Torn DealRegistry snapshots fail before market work.
  - Existing 19-Deal structured/XTrace and market truncation behavior remains
    covered.

`worker/stages/match-opportunities.ts` and `lib/corpus/service.ts` required no
new diff: the base already had the service delegation and the explicit
seed/backfill-only `buildPreloadedDealMemoryBundles()` boundary. Task 13
removes their remaining production use from the runner/process path.

## TDD evidence

Observed RED states before the corresponding production changes:

1. `ERR_MODULE_NOT_FOUND` for `lib/underwriting/orchestrator`.
2. Candidate statuses remained `queued` instead of
   `completed`/`failed`, so batch partial-failure behavior failed.
3. Missing `createSyntheticCandidateExecutor` export prevented the full
   candidate-chain test from loading.
4. Uploaded Deal processing failed on the old externally supplied canonical
   snapshot-token requirement.
5. Rank-six selection lacked a truncation warning.
6. A torn registry snapshot reached market work instead of failing during
   startup.
7. Returned batch status stayed `queued` after completed/partial automatic
   candidate processing.
8. Changing exact XTrace source lineage incorrectly reused the same batch.

Each was followed by a focused GREEN run before the next behavior was added.

## Verification

- Required Task 13 command:
  - `20/20` passed:
    `process-run-underwriting`, `process-run`, `worker-runner`, and
    `worker-health`.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- Full `npm test` inside the managed sandbox:
  - 595 total; 578 passed; 15 skipped; 2 failed only because the sandbox
    denied `listen(127.0.0.1)` with `EPERM`.
  - Re-ran the affected `tests/integration/chat-route.test.ts` outside that
    sandbox boundary: `7/7` passed.
- `git diff --check`: passed.

## Concerns / integration notes

1. Root reported two independently reproduced Task 12 decision defects:
   not-applicable specialist reference leakage and zero/negative PMF values
   satisfying the evidence gate. Task 13 intentionally did not change
   decision rules. Integrate the separate Task 12 fix before final Task 13
   review.
2. Task11b is still external to this branch. This implementation deliberately
   wires the current Task 11 synthetic lens API and leaves a provider seam for
   Task11b.
3. The current Task 8 persistence contract permits only one completed
   CandidateRun per `candidate_analysis_fingerprint`. Task 13 proves
   force-refresh batch/CandidateRun lineage, but atomically completing a
   second forced CandidateRun with byte-identical immutable inputs still
   needs an artifact-alias/reuse persistence operation or a clarified refresh
   fingerprint rule. Changing the immutable fingerprint with the refresh
   nonce would contradict the approved design, so this branch does not do so.
4. `claimNextCandidate` is a global queue API and cannot atomically claim a
   named CandidateRun. Task 13 processes candidates serially in deterministic
   creation order, which is correct for the current single-worker slice.
   Multi-batch concurrency will need a target/batch-scoped claim RPC before
   increasing concurrency above one.
