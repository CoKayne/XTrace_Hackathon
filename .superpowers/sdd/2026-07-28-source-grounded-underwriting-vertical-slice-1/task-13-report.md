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
  - Includes the canonical immutable report, complete CompanyAnalysis
    snapshots, exact Deal revisions, XTrace memory/source/fixture lineage,
    Fund Policy, execution budget, executor version, and selection policy
    version in the batch fingerprint.
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
    Context Router → Evidence Pack → deterministic valuation/scenarios →
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
  - Wires the persistent underwriting-run, Evidence Pack, Source Registry,
    XTrace lineage, and exact reference repositories; active Fund Policy;
    Task 11 synthetic lens service; source-grounded candidate executor; and
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

## Review remediation

The first Task 13 review findings are resolved:

1. **C1 — source grounding**
   - Removed the synthetic candidate executor and every invented
     Seed/B2B-SaaS/US/preferred context value.
   - Added a strict candidate-grounding port that resolves every active
     Source Revision, validates the Deal revision fingerprint, maps XTrace
     evidence IDs through the exact revision/source lineage, and feeds the
     real Task 9 Evidence Pack builder.
   - Context uses only source-explicit or confirmed fields. Missing,
     conflicting, unsupported, core-only, stale, or incomplete inputs
     become `needs_confirmation`/`unavailable`; they never become a
     completed candidate with fabricated coverage.
   - Task 9 now consumes the pinned Fund Policy scenario multipliers and the
     exact selected Benchmark entry instead of Balanced-policy/benchmark
     constants.
2. **C2 — forced rerun and failure containment**
   - Added atomic immutable artifact aliases. A linked forced CandidateRun
     with the same Deal and analysis fingerprint completes against its
     canonical source CandidateRun without duplicating artifact rows.
   - Added migration `0012_source_grounded_underwriting.sql`, the
     alias-aware finalization RPC, alias-aware artifact reads, and a partial
     uniqueness constraint that still permits only one canonical artifact
     set.
   - Checkpoint/finalization persistence errors are contained as public
     candidate failures and do not strand the batch in `running`.
3. **C3 — target-safe claiming**
   - Added and used an atomic claim keyed by exact workspace and CandidateRun
     ID. A mismatch returns no claim and mutates no unrelated row.
4. **I1 — complete replay identity**
   - The batch fingerprint now hashes all immutable report, Deal,
     CompanyAnalysis, policy, execution-budget, and executor-version inputs.
     Mutation tests cover analysis time and source metadata changes.
5. **I2 — bounded stage execution**
   - Every candidate stage now has an explicit timeout, retry allowance,
     cost units, token units, and lease-bound checkpoint.
   - Only retryable transport errors retry; deterministic stages run once.
   - Cost/token exhaustion writes a visible truncation checkpoint and
     returns an unavailable candidate rather than negative evidence.
   - Cancellation propagates through the framework service and Claude
     request, and an aborted provider request is never retried.

Production persistence added in `0012` also includes immutable source
evidence rows, exact Evidence Pack build snapshots, and structured Critical
Evidence fields in a child table so existing published reference rows remain
immutable.

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
9. Identity-only evidence invoked the lens instead of requesting four
   context confirmations.
10. A byte-identical forced rerun failed the canonical fingerprint unique
    constraint.
11. A named candidate claim leased an older queued candidate.
12. Analysis timestamp/source-metadata changes reused a stale batch.
13. A one-unit candidate budget still invoked the two-unit framework stage.
14. Caller cancellation did not reach the framework provider.
15. Supabase finalization used the non-alias-aware RPC and reusable reads
    included aliases.
16. The first `0012` PostgreSQL probes exposed an immutable-reference trigger
    conflict, function-variable binding bug, and missing RLS read policy;
    each was fixed before the full live migration suite.

Each was followed by a focused GREEN run before the next behavior was added.

## Verification

- Required Task 13 command:
  - Passed:
    `process-run-underwriting`, `process-run`, `worker-runner`, and
    `worker-health`.
- Expanded focused Task 13/finalization/evidence/reference/framework suite:
  - 73 total; 68 passed; 5 PostgreSQL-only tests skipped in the sandbox;
    0 failed.
- Live PostgreSQL migration/finalization suite outside the sandbox:
  - 12/12 passed, including target-safe claim, atomic forced-rerun alias,
    exact source-evidence persistence, and rollback probes.
- `npm run typecheck`: passed.
- `npm run lint`: passed with zero warnings.
- Full `npm test` inside the managed sandbox:
  - 614 total; 595 passed; 17 skipped; 2 failed only because the sandbox
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

---

## Fix round 2 — source-grounded identity, accounting, replay, and SQL exactness

This round resolves every remaining finding in
`task-13-fix-1-review.md` while preserving the approved C3
workspace-and-candidate-scoped claim path. It does not change Task11b,
Task12 decision behavior, or Task14/15 UI/API scope.

### Behavior fixed

1. **C1 — temporal references and immutable definitions**
   - Memory and Supabase benchmark lookup now enforce
     `effectiveAt <= asOfDate <= staleAfter`, reject future retrieval dates,
     and return no benchmark for stale 2030 requests.
   - Selected benchmarks pin entry ID, version, effective date, expiry, and a
     canonical SHA-256 definition digest.
   - Critical Evidence profiles pin a canonical digest of their exact
     structured child fields.
   - `0012` installs the immutable-reference trigger on published Critical
     Evidence child rows; runtime roles retain read-only access.

2. **C2 and I1 — stable execution identity**
   - XTrace `capturedAt` is derived from the persisted
     `CompanyAnalysis.createdAt`, never the execution clock.
   - Batch and candidate fingerprints bind the exact Critical Evidence,
     benchmark, valuation-policy, decision-policy, framework-pack, and full
     reference-catalog digests.
   - Candidate version snapshots persist those exact definition digests.
   - A one-second clock-advanced real source-grounded forced rerun now
     completes as an alias of one canonical artifact bundle.

3. **I2 — actual provider accounting and visible truncation**
   - The flat framework-stage charge is removed. Every initial, repair, and
     retryable transport request reserves one cost unit and its 4,000-token
     output capacity before the network operation starts.
   - The production Claude adapter reports provider input, output,
     cache-creation, and cache-read usage; checkpoints settle that exact
     usage after each attempt.
   - Capacity exhaustion refuses the next provider operation before dispatch.
     Framework exhaustion and timeout persist explicit truncation state and
     produce candidate unavailability, with no negative judgment inferred.
   - Retryable transport calls have unique physical-attempt fingerprints;
     arbitrary provider/budget errors are not misclassified as JSON repair.

4. **I2 — durable checkpoint replay**
   - Memory and Supabase repositories expose exact workspace/candidate
     checkpoint reads.
   - Checkpoints persist input/output fingerprints, validated replay payloads,
     bounded attempt counts, reserved/actual usage, and provider-attempt
     settlement state.
   - Completed checkpoints are immutable. Replay requires an exact input
     fingerprint, a stage-specific output parser, and a recomputed matching
     output fingerprint.
   - A reclaimed lease restores usage and reuses completed grounding and
     framework stages without repeating provider work.

5. **Additional `0012` exactness/parity finding**
   - `save_evidence_pack_build()` now compares every supplied canonical
     camelCase Source Revision snapshot byte-for-byte with its immutable
     database row.
   - Evidence Pack revision IDs and snapshot IDs must be duplicate-free exact
     sets; altered, omitted, extra, and duplicate snapshots are rejected.
   - Source timestamps are normalized to canonical UTC milliseconds before
     persistence so PostgREST offsets cannot create false mismatches.
   - Drizzle now mirrors the migration's source-evidence and Evidence Pack
     JSON shape and identity constraints.
   - The checkpoint migration is safe to reapply after the legacy
     `artifact_fingerprint` column has already been removed.

### Adversarial RED evidence

The following failures were observed before the corresponding production
changes:

- a 2030 request returned a stale benchmark, and a future-effective entry was
  not constrained by the requested as-of date;
- published Critical Evidence child rows could be updated in PostgreSQL;
- advancing only the execution clock changed a real source-grounded
  candidate/artifact identity;
- changing effective reference definition bytes did not change batch or
  candidate identity;
- measured Claude mode did not exist, the framework provider callback
  recorded zero reservations, and eight physical requests were represented
  by one 4,000-unit stage charge;
- a five-millisecond framework timeout produced generic candidate failure;
- no checkpoint read API existed, so lease reclaim repeated completed work
  and reset usage;
- the static `0012` exact-snapshot/parity assertions failed, matching the
  review's live proof that altered/partial snapshot payloads were accepted.

Each behavior received a focused GREEN run before the next slice.

### Fix-round verification

- Focused contracts/reference/evidence/framework/orchestrator/checkpoint/
  finalization suite: **96 total, 90 passed, 6 PostgreSQL-only skipped,
  0 failed**.
- Full repository suite: **628 total, 608 passed, 18 skipped, 2 failed only
  because the managed sandbox denied `listen(127.0.0.1)` with `EPERM`**.
  These are the same two known Chat route listener tests and are unrelated to
  Task 13.
- `npm run typecheck`: passed.
- `npm run lint -- --quiet`: passed.
- `git diff --check`: passed.
- Live PostgreSQL could not run in this managed sandbox: even a temporary
  local cluster failed during initialization because System V shared-memory
  creation was denied. The live exact-snapshot and Critical Evidence
  immutability probes remain present and environment-skipped; static
  migration assertions are green.
