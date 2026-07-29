# Task 12 Report — Deterministic Decisions, Narrative, and Draft Actions

## Outcome

Implemented the Task 12 underwriting output boundary:

- a fixed-order, versioned deterministic decision engine;
- separate Company Quality, Price Attractiveness, and Fund Fit results;
- minimum-input unavailability and Critical Evidence ceilings;
- reproducible mandate, hard-veto, price, ownership, return, and
  concentration rules;
- a v1 decision matrix that no narrative can override;
- a deterministic narrative assembled only from already-persisted artifacts;
- exactly five editable ActionDraft types with no delivery capability.

No Task 8 persistence file, Task 11 framework implementation, common contract,
worker, API, provider, or existing browser-local report-draft file was changed.

## TDD record

The three Task 12 test files were created first. The required RED run failed
because the decision, narrative, and action-draft modules did not exist.

After implementation, the focused compatibility run passed:

```text
18 passed, 0 failed
```

The focused suite includes the existing browser-local
`tests/unit/report-draft.test.ts`.

## Deterministic decision sequence

The engine executes:

```text
minimum model input
-> Critical Evidence ceiling
-> mandate and explicit/terms vetoes
-> Company Quality
-> Price Attractiveness
-> Fund Fit check/ownership/concentration
-> versioned v1 decision matrix
-> active decision ceiling
```

It validates that:

- the supplied coverage is exactly the coverage saved on the Evidence Pack;
- Evidence Pack and Fund Policy belong to the same workspace;
- context and Evidence Pack share the same as-of date;
- the supplied Decision Policy is the policy selected by the context.

Every evaluated rule persists:

- a stable rule ID;
- type-prefixed input references;
- pass/fail/not-applicable result;
- any applied ceiling;
- whether the rule is a veto.

The final synthesis also carries typed claim edges to saved Facts,
Calculations, Framework Judgments, Fund Policy, Decision Policy, and
Benchmark Pack. Only policy-selected judgment inputs are linked; unrelated advisory
lenses remain available to the narrative but are not falsely recorded as
formal decision dependencies. Missing field names stay in typed fired-rule
inputs, while `blockingEvidenceItemIds` contains only real saved Fact IDs
from blocking conflicts, preserving Task 8 finalization compatibility.

## Decision behavior

`Invest Candidate` requires all three dimensions to pass, Critical Evidence
to be complete, and no veto.

Company Quality uses only the policy-selected mandatory and specialist
criteria. An unrelated named `experimental_advisory` lens cannot overwrite
the formal matrix result. Such a lens is nevertheless retained in narrative
output. A named lens can affect formal Company Quality only if a future,
immutable Decision Policy explicitly selects it as a specialist critical
criterion.

Price Attractiveness requires:

- a compatible, non-stale benchmark basis;
- ask at or below maximum acceptable pre-money;
- Base gross MOIC and IRR at or above the stage target;
- pricing premium at or below the policy review threshold.

A premium above the blocker threshold or an explicit all-scenarios return
miss fails Price Attractiveness. Remaining supported misses are mixed.
Adjacent, unavailable, stale, or unknown pricing basis cannot pass.

Fund Fit checks:

- mandate;
- selected check inside the Fund Policy range;
- initial ownership inside the target range;
- optional hard minimum ownership;
- initial check plus reserve inside the concentration cap;
- supported financing terms;
- explicit user hard veto.

The selected check is the saved `selectedInitialCheck` when present. It falls
back to `initialCheckMax`, matching the current valuation engine's modeled
investment input. Balanced v1 therefore evaluates the approved
$1.5M–$8M check range, 7.5%–15% ownership range, 1.0x reserve, and 10%
concentration cap without adding a second calculation path.

## Narrative boundary

`buildUnderwritingNarrative` accepts only saved:

- Facts;
- Assumptions;
- Calculations;
- Framework Judgments;
- Framework Disagreements;
- DecisionResult.

It has no free-form model-output argument. Unknown extra input fields are not
used. It renders every supplied framework judgment and disagreement,
including future real named advisory lenses, while preserving the formal
decision, ceiling, veto, and independent dimensions verbatim.

The tests verify that injected model text cannot introduce an unsaved number
or change the formal label.

## Draft-only boundary

`createActionDraftGenerator` emits exactly:

- email;
- SMS/short message;
- LinkedIn message;
- internal memo;
- due-diligence request.

Each artifact contains only the strict persisted `ActionDraft` fields:

```text
id
workspaceId
candidateRunId
channel
audienceType
body
createdAt
updatedAt
```

There is no recipient, address, handle, delivery state, send method, provider
ID, provider integration, send function, or publish function.

## Verification

Passed:

- Task 12 plus report-draft compatibility: 18 passed, 0 failed.
- `npm run typecheck`
- `npm run lint`
- `git diff --check`
- previously failing localhost Chat integration file outside the sandbox:
  7 passed, 0 failed.
- PostgreSQL schema/finalization files rerun serially:
  15 passed, 0 failed.

The repository-wide parallel run executed 585 tests and reached 581 passes,
1 external skip, and 3 PostgreSQL setup failures. All three failures were the
known cluster-global role creation race (`tuple concurrently updated`) caused
by parallel migration tests. The exact two affected migration files passed
all 15 tests when rerun serially.
