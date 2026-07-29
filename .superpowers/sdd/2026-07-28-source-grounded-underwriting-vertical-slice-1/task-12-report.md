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

---

## Fix round 1 — fail-closed PMF evidence and specialist dependency scope

### Review findings addressed

This round addresses both Important findings from the independent Task 12
review.

1. `stagePmfEvidenceIds()` now accepts only field-specific, positive,
   parseable PMF evidence.
2. Policy-listed specialist judgments with `not_applicable` or `unavailable`
   applicability remain persisted and narrated, but are excluded from the
   formal Company Quality rule references and final-decision claim edges.

The existing rule that a missing, `not_applicable`, or `unavailable`
**mandatory** framework judgment makes Company Quality unavailable was
preserved and given an explicit regression test.

### TDD record

Regression tests were added before production changes.

The first executable RED run produced three expected failures:

```text
Seed PMF evidence fails closed...
  paying_customers=0: expected mixed, received pass

Series A PMF evidence requires positive customer and performance values
  expected mixed, received pass

non-applicable and unavailable specialist judgments remain advisory...
  specialist reference was present in the formal Company Quality rule
```

The Task 8 finalization compatibility test was already green in the RED run:
the persistence boundary correctly stored advisory specialist judgments
without requiring a decision claim edge to them.

### PMF evidence semantics

The PMF gate now fails closed by field type:

- count fields (`paying_customers`, `production_customers`,
  `design_partners`, and `customer_count`) require a parseable numeric value
  greater than zero;
- singular boolean/status fields (`paying_customer`,
  `production_customer`, and `design_partner`) require an explicit normalized
  positive value such as `true`, `active`, `confirmed`, or `signed`;
- money/performance fields (`arr`, `revenue`, and `recurring_revenue`)
  require a parseable numeric value greater than zero;
- retention fields require a parseable value greater than zero and a valid
  rate unit: decimal/rate/ratio values must be at most `1`, while
  percent/percentage/pct/`%` values must be at most `100`;
- generic `customer_evidence` text requires an explicit positive customer or
  design-partner statement and rejects negated, future, target, potential, and
  otherwise ambiguous statements.

Series A still requires both a positive customer fact and a positive
performance fact. Zero, false, `none`, ambiguous text, invalid units, and
unparseable values no longer become formal PMF dependencies.

Regression controls cover:

- Seed values `0`, `false`, and `none`;
- negated, ambiguous, and future-looking generic text;
- positive count, boolean, status, and explicit-text examples;
- a mixed sentence where an unrelated negated design-partner statement does
  not hide an explicit positive paying-customer statement;
- Series A zero customer plus zero ARR/retention;
- positive Series A ARR and retention controls.

### Specialist dependency semantics

All policy-listed specialist judgments continue to flow through persistence
and narrative rendering.

Only specialist judgments with `applicability === "applicable"` are included
in the Company Quality fired rule's `framework_judgment:*` inputs. Therefore,
only those applicable specialist judgments can appear in the
`DecisionResult.claimEdges` derived from formal fired-rule references.

An applicable, high-confidence negative specialist remains a formal
dependency, fails Company Quality, and produces a `Pass` decision. Advisory
`not_applicable` and `unavailable` specialists do not affect the formal
decision.

### Task 8 compatibility

A new memory-finalization integration regression proves that Task 8:

- persists `not_applicable` and `unavailable` specialist judgments exactly;
- persists their narrative representation;
- does not require the final decision to claim either advisory judgment as a
  dependency.

The same finalization suite was run against a live temporary PostgreSQL
database. Its atomic rollback, real Task 10 calculation-lineage finalization,
and zero-candidate completion cases all passed.

### Verification

Passed after the final production change:

- decision and narrative unit regressions: 18 passed, 0 failed;
- Task 12, browser-local report compatibility, Task 8 memory runs, and
  finalization: 37 passed, 0 failed, 3 PostgreSQL-only cases skipped;
- live PostgreSQL Task 8 finalization suite: 10 passed, 0 failed;
- `npm run typecheck`;
- `npm run lint`;
- `git diff --check`.

---

## Fix round 2 — whole-assertion generic customer evidence

### Remaining review finding addressed

The second independent review confirmed that the structured count, status,
money, and retention predicates and the specialist-dependency correction
were sound. Its sole remaining Important finding was that generic
`customer_evidence` still used a positive-substring match plus a nearby
32-character veto window.

That heuristic has been removed. Generic customer text now fails closed at
the complete-assertion boundary. Canonical structured fields remain the
preferred path and retain the field-specific behavior approved in fix round
1.

### TDD record

Before changing production code, the exact three review probes were added:

```text
We expect to have three paying customers next quarter.
We may have three paying customers next quarter.
We previously had three paying customers, but all have churned.
```

The RED run failed on the first newly reached probe:

```text
customer_evidence=We expect to have three paying customers next quarter.
expected Company Quality mixed, received pass
```

The final regression evaluates all three assertions before comparing results.
For every probe it now verifies:

- Company Quality is `mixed`;
- the decision is `Advance`, never `Invest Candidate`;
- the Fact is absent from the Company Quality fired-rule references.

### Conservative whole-assertion predicate

Generic text is accepted only when all of the following hold:

1. The complete assertion contains no modal, conditional, expected, planned,
   targeted, forecast, projected, future, historical, previously,
   no-longer-current, churned, lost, cancelled, or equivalent disqualifier.
2. Each clause is a tightly bounded present-tense affirmative customer/design
   partner form, or a simple bounded negative clause about a different PMF
   signal.
3. At least one current positive signal is present.
4. No negative clause contradicts the same customer-evidence kind.

The accepted grammar is deliberately narrow. It recognizes current
affirmative statements such as:

```text
Three paying customers are live in production.
We have three paying customers.
Currently, the company has five production customers.
```

It also preserves the previously approved mixed positive control:

```text
No design partners yet, but three paying customers are live.
```

The negative design-partner clause does not contradict the current paying
customer signal. Any unrecognized or ambiguous additional clause makes the
entire generic assertion ineligible.

### Adversarial self-review

Additional regressions reject:

- conditional future conversion;
- a current-looking statement followed by `no longer active`;
- a current-looking statement followed by cancelled contracts;
- a direct same-signal contradiction.

The original structured count, boolean/status, ARR, retention, specialist,
mandatory-judgment, narrative, and Task 8 finalization regressions remain
green.

### Verification

Passed after the final fix-round-2 changes:

- decision unit suite: 16 passed, 0 failed;
- Task 12, browser-local report compatibility, Task 8 memory runs, and
  finalization: 38 passed, 0 failed, 3 PostgreSQL-only cases skipped;
- live PostgreSQL Task 8 finalization suite: 10 passed, 0 failed;
- `npm run typecheck`;
- `npm run lint`;
- `git diff --check`.
