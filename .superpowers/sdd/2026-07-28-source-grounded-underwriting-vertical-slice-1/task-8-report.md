# Task 8 Report: Persist idempotent candidate artifacts

## Outcome

Implemented the durable Task 8 underwriting execution boundary:

- canonical batch and candidate fingerprints;
- workspace-scoped idempotent batches and explicit refresh reruns;
- deterministic Top-5 selections and CandidateRun creation;
- lease-capability candidate claims and checkpoint writes;
- immutable candidate artifact tables;
- atomic PostgreSQL finalization;
- workspace-scoped artifact reuse that returns the exact saved bundle;
- strict TypeScript and PostgreSQL claim-lineage validation.

The legacy `save_intelligence_report` path was neither called nor replaced.

## TDD record

The first focused run was RED because the three Task 8 modules did not
exist. The implementation was then developed against:

- `tests/unit/underwriting-fingerprints.test.ts`
- `tests/unit/underwriting-runs.test.ts`
- `tests/integration/underwriting-finalization.test.ts`

A later RED PostgreSQL test demonstrated that the first SQL finalization
implementation accepted an unresolved typed claim dependency. The SQL RPC
was corrected to validate judgment and decision claim edges, as well as
calculation input references, before commit. The same live test then passed
and confirmed that the entire transaction rolls back.

## Durable schema and RPCs

`drizzle/0011_underwriting_runs.sql` and `db/schema.ts` now define:

- `underwriting_batches`
- `underwriting_selections`
- `candidate_runs`
- `candidate_checkpoints`
- `evidence_packs`
- `candidate_context_snapshots`
- `scenario_models`
- `underwriting_calculations`
- `framework_judgment_artifacts`
- `framework_disagreement_artifacts`
- `valuation_evaluations`
- `final_syntheses`
- `underwriting_narratives`
- `action_drafts`
- `underwriting_claim_edges`
- `candidate_version_snapshots`

The write surface is limited to controlled RPCs:

- `create_or_reuse_underwriting_batch`
- `save_underwriting_selections`
- `create_selected_underwriting_candidates`
- `claim_next_underwriting_candidate`
- `save_underwriting_checkpoint`
- `mark_candidate_underwriting_unavailable`
- `mark_candidate_underwriting_failed`
- `finalize_candidate_underwriting`

`service_role` has read access to Task 8 tables and execute access to the
controlled RPCs, but no direct table mutation access. Final artifact tables
also reject updates and deletes through immutable triggers.

Finalization verifies the active worker lease, candidate identity, context
and version parity, action-draft identity, calculation inputs, and typed
claim dependencies. All artifacts, claim edges, the exact version snapshot,
and the completed CandidateRun transition commit in one PostgreSQL
transaction.

## Repository behavior

`db/repositories/underwriting-runs.ts` provides equivalent memory and
Supabase implementations for:

- batch replay and explicit refresh replay;
- rank normalization;
- CandidateRun idempotency;
- exclusive lease claim and expired-lease reclaim;
- lease-bound checkpoints;
- unavailable, failed, partial, and completed batch outcomes;
- atomic artifact finalization.

`db/repositories/underwriting-artifacts.ts` validates the complete artifact
bundle before any memory commit. It verifies unique identities, internal
artifact references, evidence references, calculation inputs, and every
typed claim dependency. Reuse is scoped by workspace and returns the exact
persisted artifact bundle and version snapshot.

## Fingerprints

`lib/underwriting/fingerprints.ts` uses canonical JSON and SHA-256.

The batch fingerprint binds:

- workspace and exact 14-day window;
- immutable market snapshot;
- eligible Deal revision and current status set;
- XTrace lineage;
- selected events;
- matching model, prompt, schema, scoring, selection, and judgment versions;
- Fund Policy snapshot;
- Framework, Router, and Decision versions.

The candidate fingerprint additionally binds:

- batch fingerprint;
- exact Deal revision;
- Evidence Pack and source IDs;
- resolved context;
- Critical Evidence, Benchmark, Valuation Method, and Formula versions;
- provider model, prompt, schema, settings, and application commit.

Unordered semantic sets are normalized, so input order does not change a
fingerprint while every required version dimension does.

## Two interface clarifications

The brief's literal return/input types could not safely carry the lease
capability required by its own finalization contract. The approved
functional resolution is:

```ts
interface ClaimedCandidateRun {
  candidate: CandidateRun;
  leaseToken: string;
  leaseExpiresAt: string;
}
```

`claimNextCandidate` returns `ClaimedCandidateRun | null`.

Checkpoint writes use:

```ts
type CandidateCheckpointWrite = CandidateCheckpoint & {
  workerId: string;
  leaseToken: string;
};
```

The stored and public `CandidateRun` and `CandidateCheckpoint` shapes remain
strict and do not expose worker credentials.

## Verification

Passed:

- Focused Task 8 tests: 13 passed, 0 failed, 1 PostgreSQL-gated skip.
- Live Task 8 PostgreSQL tests: 6 passed, 0 failed, 0 skipped.
- Full serialized suite: 562 passed, 0 failed, 1 external XTrace test skipped.
- Dedicated migration suite: 8 passed, 0 failed.
- `npm run typecheck`
- `npm run lint`
- `git diff --check`

The default parallel full-suite invocation once encountered PostgreSQL
`tuple concurrently updated` while independent tests simultaneously created
the same cluster-global role. Running the same suite serially eliminated
that test-infrastructure race and passed every executable test.

## Scope

No Task 5 registry hardening or Task 9 evidence/router implementation was
added to this commit. Those remain separate review and integration units.
