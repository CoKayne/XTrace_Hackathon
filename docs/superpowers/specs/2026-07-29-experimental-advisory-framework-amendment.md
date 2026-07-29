# Experimental Advisory Framework Execution — Product Amendment

Date: 2026-07-29  
Applies to:

- `2026-07-28-source-grounded-vc-underwriting-design.md`
- `2026-07-28-source-grounded-underwriting-vertical-slice-1.md`

This amendment supersedes the earlier rule that every draft or unpublished
named framework must abstain from runtime execution.

## Product intent

The distilled named investor and VC frameworks must produce real,
source-grounded opinions inside the end-to-end underwriting flow. They are not
static research artifacts and must not be replaced by generic synthetic labels
in the final product report.

The product keeps two separate boundaries:

1. **Advisory execution**: a named framework may evaluate the immutable
   Evidence Pack and produce a complete, cited opinion.
2. **Formal decision authority**: a named framework may become a weighted
   deterministic decision factor only after its publication, rights, content
   review and Decision Utility gates pass.

## Eligible research content

The audited research handoff contains:

- 20 framework packs;
- 199 Framework Cards;
- 270 source records.

Runtime advisory execution may use only Cards satisfying all of:

- `rights.status = public_source_paraphrase`;
- `review.contentStatus = draft`;
- `review.publicationStatus = unpublished`;
- `decisionUtility.formalDecisionWeight = 0`;
- every referenced source and locator resolves inside the same audited pack.

The 19 Cards with `rights.status = pending_review` are excluded and must never
enter a model prompt.

## Runtime unit

The runtime unit is one composite advisory lens per research pack, not one
model call per Card.

For a candidate, the loader:

1. validates the pack, Cards and source catalog;
2. filters Cards by stage, business model, geography and security type;
3. excludes ineligible or pending-review Cards;
4. deterministically composes the remaining Cards into one immutable pack lens;
5. fingerprints the exact pack version, component Card IDs, neutral
   paraphrases, rules, limitations and source references.

The composite retains:

- pack name, attribution and version;
- component Card IDs and versions;
- neutral paraphrases;
- decision questions;
- positive signals and red flags;
- disconfirming evidence and contraindications;
- empirical qualifications;
- source IDs and exact locators;
- explicit statements that the result is a product synthesis, not endorsement,
  private reasoning or reconstructed hidden chain of thought.

At most 20 composite named lenses run per candidate. Default model concurrency
is four. A non-applicable, truncated or failed lens is unavailable or abstains;
it is never negative company evidence.

## Grounded output

Each applicable named lens produces an independent persisted judgment with:

- applicability;
- complete conclusion;
- strongest supporting evidence;
- strongest counterevidence;
- unused evidence;
- unknowns;
- limitations;
- separate confidence dimensions;
- exact company Evidence Pack item IDs;
- exact framework pack, component Card and source metadata.

Opposing named lenses are preserved as
`independent_framework_conflict`; the product never averages them into a
single invented consensus.

The model has no browsing or tool access and cannot:

- introduce a company fact absent from the Evidence Pack;
- recalculate a valuation;
- create or modify a deterministic formula;
- output or overwrite a formal investment decision;
- send or publish an external action.

## Effect on the investment report and decision

Named advisory judgments must appear in:

- Company Underwriting;
- framework agreement and disagreement sections;
- unknowns and diligence requests;
- narrative rationale;
- draft-only next actions.

They are therefore real product outputs, not decorative content.

While their formal decision weight remains zero:

- they cannot independently promote a candidate to `Invest Candidate`;
- they cannot bypass Critical Evidence ceilings, hard vetoes, Fund Policy,
  valuation results or the deterministic Decision Policy;
- the report must visibly distinguish experimental advisory opinion from a
  published formal decision factor.

Promotion to a formal factor requires all gates recorded in
`research/framework-authoring/README.md` and
`docs/technical-debt/2026-07-29-end-to-end-deferred-hardening.md`.

## Acceptance tests

The implementation must prove:

1. all 20 packs, 199 Cards and 270 sources load deterministically;
2. exactly 180 public-source Cards are eligible and 19 pending-review Cards are
   excluded;
3. one candidate triggers at most one model call per applicable pack;
4. context filtering occurs before a model call;
5. a caller-created lookalike Card cannot bypass the audited loader catalog;
6. the same fingerprint performs zero repeat model calls;
7. full component and source metadata is retained for the report;
8. opposing advisory judgments remain separate;
9. prompts are not persisted or exposed;
10. named advisory output cannot change a fixed deterministic decision result.
