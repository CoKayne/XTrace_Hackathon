# Framework Fidelity and Decision Utility Review

Research cutoff: 2026-07-28  
Corpus: 20 packs, 199 Cards, 270 catalogued sources

## Outcome

The corpus is suitable as a **draft research-question library**. It is not yet
suitable as a published named-investor product or as a weighted investment
decision system.

- 199/199 Cards have formal decision weight `0`.
- 160 Cards are `candidate`; this means candidates for validation, not
  validated factors.
- 39 Cards are `advisory`.
- 0 Cards are `validated_decision_factor`.
- 0 Cards are content-approved or published.
- 19 Cards remain `pending_review` for rights.

Framework fidelity and decision utility are separate axes. A faithful
paraphrase of an investor's public view may have no demonstrated predictive
value. A useful product synthesis may not be attributable to that investor.
The UI and registry must never collapse those facts.

## Axis 1 — Framework Fidelity

### F0: Blocked

One or more displayed claims lack adequate rights, source access, exact
location, or attribution. The Card cannot be published.

Current F0 rights blockers:

- `OA2-08`
- `BVC-02`, `BVC-03`, `BVC-04`, `BVC-05`, `BVC-09`
- `VCFI-03` through `VCFI-10`
- `FD-02`, `FD-04`, `FD-06`, `FD-07`, `FD-10`

### F1: Product-safe synthesis

Claims are source-linked and neutrally paraphrased, but the final rule is a
product inference across sources. The UI must say “product synthesis informed
by…” and must not say “X investor's rule.”

This is the dominant corpus class: 116 Cards.

### F2: Attributed public doctrine

The Card closely follows a person's direct public statement, a coauthored work,
or an institution's public doctrine. It still requires version, context,
applicability, and empirical limitations.

Current composition:

- person direct: 59
- coauthored work: 20
- institution doctrine: 3
- revealed behavior: 1

### F3: Reviewed public framework

Requirements:

1. every displayed proposition maps to an exact source locator;
2. attribution scope is independently checked;
3. selected cases, historical figures, and time-bound guidance are labeled;
4. neutral paraphrase is non-substitutive and rights-approved;
5. applicability and contraindications are reviewed by a domain specialist;
6. product inference is visually separated from source doctrine;
7. a reviewer approves a pinned version.

No Card is currently F3.

## Axis 2 — Decision Utility

### U0: Question generation only

The lens can identify diligence questions but cannot change Watch, Advance, or
Invest Candidate.

Typical examples:

- named-investor contrarian or founder lenses;
- selected historical cases;
- culture, value-add, and personality-adjacent content;
- broad normative advice.

### U1: Structured advisory

The lens has explicit required evidence, counterevidence, confidence anchors,
and reproducible output structure. It may support Watch/Advance rationale but
has no formal weight.

Most current `candidate` Cards are at best U1.

### U2: Validated advisory

Requirements:

1. locked-time retrospective testing without future-data leakage;
2. successful, failed, passed, and no-decision comparison cases;
3. inter-rater and rerun reproducibility;
4. calibration, false-positive, and false-negative reporting;
5. ablation showing incremental decision information;
6. stage, sector, geography, and business-model limits;
7. prospective shadow-mode monitoring;
8. model/version drift controls.

No Card has completed U2 evidence.

### U3: Validated decision factor

In addition to U2:

- the deterministic Decision Policy defines its exact input, transformation,
  weight or gate, missing-data behavior, and version;
- prospective validation supports the claimed use;
- legal, fiduciary, bias, and domain review is complete;
- the Card is content-approved and published;
- monitoring and rollback criteria exist.

No Card is U3.

## High-risk promotion categories

### Founder and people judgments

Examples: `SQ-04`, `VM-05`, `SHR-02`, `FD-*`, `SP-*`.

Risks:

- affinity, pedigree, demographic, accent, charisma, disability, and
  communication-style bias;
- personality inference from sparse evidence;
- normalizing burnout or harmful working conditions;
- confusing outcome knowledge with ex-ante judgment.

Required controls:

- standardized role-specific questions;
- work samples and longitudinal decisions;
- blind irrelevant identity where feasible;
- diverse references including difficult cases;
- fairness and inter-rater testing;
- human review; no automated personality or protected-trait inference.

These should remain advisory unless a narrow, behavior-based factor is
independently validated.

### Governance, terms, fund, and fiduciary judgments

Examples: `VD-*`, `SHR-06`–`SHR-10`, `FD-07`–`FD-09`, `BVC-*`, `SQ-09`,
`SQ-10`.

Required controls:

- jurisdiction and document version;
- counsel-reviewed parsers and state machines;
- fully diluted cap table and security waterfall;
- board, voting, consent, conflict, and fiduciary maps;
- explicit human and legal review.

Language-model output cannot replace legal interpretation.

### Valuation and financial judgments

Examples: `DSV-*`, `VCFI-*`, `EI-*`, `BG-01`–`BG-09`, `NN-01`,
`NN-04`, `NN-05`.

Required controls:

- reconciled accounting and cash;
- deterministic calculations with unit and property tests;
- explicit scenario and sensitivity inputs;
- method-specific output, never mechanical averaging;
- versioned price, cap table, preferences, and ownership;
- value, price, expected return, and decision kept separate.

The language model may map evidence to assumptions and explain discrepancies;
it must not perform authoritative arithmetic.

### Historical and named-investor lenses

Examples: `PT-*`, `VM-*`, `PL-*`, `MA-*`, `BG-*`, `MMI-*`, `SQ-*`.

Required controls:

- clear direct/coauthored/institution/revealed/synthesis label;
- no persona imitation or private chain-of-thought claim;
- no social-status or fame weighting;
- failed and passed cases;
- source-date and market-regime limits;
- no claim that the named person endorses the product or current company.

## Validation design

### 1. Locked-time historical study

For each case, freeze the Evidence Pack at the actual decision date. Hide all
future funding, press, outcomes, and current reputation. Include:

- investments that succeeded;
- investments that failed;
- passed companies that later succeeded;
- passed companies that later failed;
- watched companies with no clear outcome.

Measure evidence completeness, rerun consistency, false alerts, missed alerts,
and whether the lens changed a decision-relevant uncertainty.

### 2. Prospective shadow mode

Run lenses without affecting decisions for a defined period. Before outcomes:

- pin Card, source, model, prompt, calculator, and policy versions;
- record evidence available at analysis time;
- record human disagreement and overrides;
- set the update event and outcome window in advance.

### 3. Reproducibility

Repeat the same Evidence Pack:

- across model runs;
- across supported models;
- across trained human reviewers;
- with evidence order shuffled;
- with irrelevant founder identity removed.

Large unexplained changes block promotion.

### 4. Ablation and conflict testing

Compare:

- baseline underwriting without the Card;
- Card present;
- Card present but named attribution hidden;
- positive and negative evidence removed in turn;
- conflicting lens pairs from the conflict matrix.

The Card should add decision-relevant information, not brand authority or
verbosity.

### 5. Calibration and monitoring

Confidence is confidence in source, evidence, coverage, applicability, and
judgment—not probability of startup success. If a probability is ever shown,
it must come from a separately validated model with an explicit target,
population, horizon, and calibration report.

## Promotion checklist

A Card cannot become `validated_decision_factor` unless all are true:

- [ ] rights approved;
- [ ] exact locators and immutable source revision recorded;
- [ ] attribution and neutral paraphrase independently reviewed;
- [ ] applicability and contraindications domain-reviewed;
- [ ] required Evidence Pack fields implemented;
- [ ] deterministic calculations implemented and tested;
- [ ] conflict-family membership declared;
- [ ] locked-time historical validation completed;
- [ ] prospective shadow validation completed;
- [ ] calibration, false-positive, false-negative, and subgroup review
      completed;
- [ ] legal, fiduciary, privacy, and bias review completed where applicable;
- [ ] content status approved;
- [ ] publication status published;
- [ ] monitoring, versioning, rollback, and retirement rules implemented.

## Main-system integration recommendation

For Task 7/11:

1. Load only schema-valid Cards from a pinned Pack version.
2. Reject rights-pending, unapproved, or unpublished Cards in production.
3. Store attribution scope independently from the display label.
4. Ask only the Card's declared questions and required evidence.
5. Emit the seven-part Decision Trace, not hidden chain of thought.
6. Run all applicable lenses independently.
7. Attach the conflict-family output without averaging.
8. Call deterministic services for all finance, cap-table, term, cohort, and
   scenario calculations.
9. Run the fund's Decision Policy last.
10. Preserve source, Card, model, calculator, and policy versions in the final
    report.
