# Framework Authoring Research

This directory is the only handoff surface between the content-research side quest
and the underwriting system.

## Bigger picture

The product already owns the system layer:

- Framework Registry and published version pinning;
- Evidence Pack creation;
- independent lens execution;
- preservation of disagreements;
- valuation calculations;
- deterministic Decision Policy;
- report and action-draft generation.

This directory owns only the content layer:

- identify legal, auditable public sources;
- separate direct doctrine, institution doctrine, revealed behavior, product
  inference, and empirical qualification;
- create neutral Framework Cards with applicability and evidence requirements;
- preserve counterevidence, limitations, and conflicts;
- prepare a versioned Framework Pack that Task 7/11 can review and transform into
  `seed/underwriting/framework-pack-v1`.

It does **not**:

- imitate an investor's personality;
- reconstruct or expose private chain of thought;
- claim that a named investor endorses the product or a specific investment;
- decide `Invest Candidate`;
- provide hidden prompts for the runtime;
- seed or modify production registries directly.

## Directory contract

```text
research/framework-authoring/
  README.md
  methodology/
    dual-track-distillation-protocol.md
  contracts/
    framework-card.schema.json
    framework-pack.schema.json
  authors/
    peter-thiel/
      source-inventory.md
      atomic-claims.md
      sources.json
      cards/
        *.card.json
      peter-thiel-public-frameworks.pack.json
      review-notes.md
```

Later authors follow the same shape.

## Current research packs

| Pack | Cards | Sources | Status | Formal decision weight |
|---|---:|---:|---|---:|
| Peter Thiel public frameworks | 10 | 23 | draft / unpublished | 0 |
| The Venture Mindset public frameworks | 9 | 11 | draft / unpublished | 0 |
| Scott Kupor / Secrets of Sand Hill Road public frameworks | 10 | 12 | draft / unpublished | 0 |
| Super Founders public frameworks | 10 | 13 | draft / unpublished | 0 |
| Hamilton Helmer / 7 Powers public frameworks | 10 | 10 | draft / unpublished | 0 |
| Aswath Damodaran / The Dark Side of Valuation public frameworks | 10 | 12 | draft / unpublished | 0 |
| Metrick / Yasuda Venture Capital Finance public frameworks | 10 | 18 | draft / unpublished | 0 |
| Mauboussin / Rappaport Expectations Investing public frameworks | 10 | 20 | draft / unpublished | 0 |
| Feld / Mendelson Venture Deals public frameworks | 10 | 20 | draft / unpublished | 0 |
| Aswath Damodaran / Narrative and Numbers public frameworks | 10 | 14 | draft / unpublished | 0 |
| Mahendra Ramsinghani / The Business of Venture Capital public frameworks | 10 | 15 | draft / unpublished | 0 |
| Howard Marks / The Most Important Thing public frameworks | 10 | 15 | draft / unpublished | 0 |
| Sebastian Mallaby / The Power Law public frameworks | 10 | 9 | draft / unpublished | 0 |
| Andrew Chen / The Cold Start Problem public frameworks | 10 | 8 | draft / unpublished | 0 |
| Noam Wasserman / The Founder's Dilemmas public frameworks | 10 | 14 | draft / unpublished | 0 |
| April Dunford / Obviously Awesome updated and expanded public frameworks | 10 | 11 | draft / unpublished | 0 |
| Claire Hughes Johnson / Scaling People public frameworks | 10 | 14 | draft / unpublished | 0 |
| Marc Andreessen public frameworks | 10 | 10 | draft / unpublished | 0 |
| Bill Gurley public frameworks | 10 | 9 | draft / unpublished | 0 |
| Sequoia / Don Valentine / Michael Moritz public frameworks | 10 | 12 | draft / unpublished | 0 |

Counts describe the current research revision and may change after licensed
chapter review. A pack appearing here does not authorize runtime publication.

## Content-to-system boundary

Only JSON documents that validate against `contracts/` are machine handoff
artifacts. Markdown files are research notes and reviewer context.

Cross-pack reviewer artifacts are stored in `review/`. They describe source
coverage, rights blockers, framework conflicts, and promotion gates. They are
not runtime factors and do not modify any Card's status or weight.

The review directory also contains the lawful-source acquisition backlog:

- `review/licensed-source-gap-register.json` is the machine-readable handoff
  for missing books, reviewed excerpts, and affected Cards;
- `review/licensed-source-gap-register.md` is the human-readable acquisition
  order and safe source-handling procedure.

Copyrighted books and user-provided files must never be committed. Only source
metadata, hashes, neutral non-substitutive paraphrases, exact locators, and
review status belong in this repository.

A Card may enter the runtime seed only when:

1. every displayed proposition has a source reference and exact locator;
2. attribution scope is correct;
3. the paraphrase is neutral and non-substitutive;
4. rights status permits the intended use;
5. applicability, contraindications, and required evidence are explicit;
6. positive signals, red flags, and disconfirming evidence are distinct;
7. confidence anchors describe evidence states, not success probability;
8. conflicting and overlapping frameworks are declared;
9. content review status is `approved`;
10. publication status is `published`.

The research branch normally emits `draft` or `review_ready`. The main system
owner controls publication.

## Required Card fields

Every Framework Card includes:

- identity, version, attribution, and positioning;
- source references with exact locations;
- neutral paraphrase;
- applicable stage, business model, sector, geography, and security type;
- required conditions and required evidence;
- decision questions;
- positive signals;
- red flags;
- disconfirming evidence;
- contraindications;
- confidence anchors;
- overlap and conflict references;
- rights and review status;
- Decision Utility status.

## Runtime reasoning contract

The runtime should produce an auditable Decision Trace, not hidden chain of
thought:

1. Evidence
2. Applicable Rule
3. Judgment
4. Counterevidence
5. Unknowns
6. Limited Conclusion
7. Next Evidence Request

Each named framework remains an independent lens. The deterministic Decision
Policy may use a card as a formal factor only when `decisionUtility.status` is
`validated_decision_factor`. Draft, advisory, and candidate cards may inform
research or Watch/Advance rationale but do not independently create an
`Invest Candidate`.

## Current branch and baseline

- Branch: `research/framework-authoring`
- Isolated worktree: `.worktrees/framework-authoring`
- Baseline test run: 237 total; 229 passed, 6 skipped, 2 environment failures.
- The two failures were `listen EPERM 127.0.0.1` in local HTTP test fixtures in
  the restricted execution environment, before any framework-authoring change.
