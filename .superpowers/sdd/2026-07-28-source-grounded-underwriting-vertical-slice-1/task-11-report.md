# Task 11 Report — Grounded Independent Framework Lenses

## Outcome

Implemented the bounded synthetic framework-lens core for Vertical Slice 1.

The service:

- executes only the exact eight published, product-owned synthetic Task 7
  cards with formal decision weight `0`;
- leaves every draft, real named, altered, or unregistered lookalike card
  inert and persists an abstention without calling Claude;
- gives each lens only its own card and the same immutable Evidence Pack;
- gives only `Valuation & Fund Return` the already-saved Calculations and
  immutable Valuation Method Policy / Benchmark references;
- exposes no browsing, tool, decision, ceiling, veto, action, or calculation
  output surface;
- strictly validates support, counterevidence, unknowns, confidence
  dimensions, evidence partitions, exact framework references, and typed
  claim edges;
- performs exactly one repair after malformed or ungrounded model output,
  then persists an `unavailable` abstention if repair also fails;
- replays an immutable fingerprinted cache record without an additional model
  call and stores execution metadata without prompts or raw responses; and
- deterministically persists opposing applicable judgments as disagreements
  while preserving both conclusions and their grounded evidence.

No Task 8 integration, finalization, repository, or migration file was
modified by Task 11.

## Grounding and execution boundary

`ClaudeFrameworkLensOutputSchema` is a strict output contract. Applicable
outputs require:

- a non-abstaining bounded conclusion;
- at least one grounded supporting item;
- at least one grounded counterevidence item;
- strongest-support and strongest-counterargument text;
- at least one explicit unknown;
- five separate confidence dimensions; and
- the exact selected Framework Card reference.

Support, counter, and unused IDs must form a duplicate-free exact partition of
the permitted immutable inputs. Ordinary lenses can resolve only Evidence
Pack Facts and Assumptions. The valuation lens may additionally resolve saved
Calculation IDs. Persisted claim edges are derived server-side from those
validated IDs rather than accepted from model output.

The executable-card gate compares the complete card against the immutable
Task 7 fixture, in addition to checking publication, ownership, synthetic
status, rights status, and zero formal weight. A card that merely imitates
those governance fields cannot execute.

## Independent prompts and repair

Every model call receives:

- one card;
- one Evidence Pack; and
- for the valuation card only, saved Calculations plus the pinned Valuation
  Method Policy and Benchmark IDs.

The system instruction treats all input text as untrusted data, denies
browsing and tool access, forbids new company facts and recalculation, and
forbids formal decision output. A validation failure produces one bounded
repair request containing the original request, validation error, and prior
response. There is no third call.

## Cache and disagreements

The lens fingerprint binds the Evidence Pack, complete card/version, resolved
context, valuation-scoped Calculations, provider, model, prompt version,
schema version, settings fingerprint, and application commit.

Cache records expose only:

- fingerprint;
- grounded judgment; and
- provider/execution metadata including attempt and repair status.

They do not retain the system prompt, messages, or raw model response.

The disagreement builder uses stable semantic card pairs for the five
contract topics. It creates an artifact only when both judgments are
applicable and one is `supportive` while the other is `negative`. Input order
does not change the result. Both judgment IDs, both conclusions, and the
stable union of their supporting and counterevidence IDs remain intact.

## TDD evidence

Observed RED failures before implementation:

- grounding tests failed because the framework schema and grounding module did
  not exist;
- lens tests failed because the independent lens service did not exist;
- disagreement tests failed because the disagreement builder did not exist;
- an unregistered synthetic lookalike test made two model calls before the
  exact Task 7 fixture gate was added; and
- strict-output tests initially accepted empty unknowns and missing
  counterevidence before those invariants were enforced.

Focused GREEN:

```text
Framework grounding, lens, disagreement, and existing matching tests:
15 passed
0 failed
```

This includes happy-path independent execution, valuation-only Calculation
access, schema and lineage failures, exactly-one repair, second-failure
abstention, cache replay, prompt-free cache inspection, disagreement
preservation, draft/lookalike/non-applicable abstention, and matching-reasoner
regression coverage.

## Verification

Passed:

- Task 11-focused TypeScript compile, including all transitive production
  dependencies and Task 11 tests;
- repository-wide TypeScript typecheck;
- repository-wide lint with zero errors and zero warnings;
- focused test suite: 15 passed, 0 failed;
- `git diff --check`.

## Files delivered

- `lib/underwriting/frameworks/schemas.ts`
- `lib/underwriting/frameworks/grounding.ts`
- `lib/underwriting/frameworks/claude-lens.ts`
- `lib/underwriting/frameworks/disagreements.ts`
- `lib/underwriting/frameworks/service.ts`
- `lib/claude/schemas.ts`
- `lib/claude/service.ts`
- `tests/unit/framework-grounding.test.ts`
- `tests/unit/framework-lens.test.ts`
- `tests/unit/framework-disagreement.test.ts`

## Deliberate scope boundary

This commit executes only Task 7 synthetic fixtures. Real named Side Quest
framework cards remain non-executable here. A separately reviewed follow-up
may introduce a rights-safe advisory execution mode; it must not change the
formal deterministic decision weight or allow a single named viewpoint to
override the investment decision.
