# Licensed Source Acquisition Backlog

Research cutoff: 2026-07-29

This is the human-readable companion to
`licensed-source-gap-register.json`. It records which lawfully acquired books
would improve Framework Fidelity. It is reviewer metadata, not a runtime
Framework Card, score, or investment factor.

## Current completion interpretation

| Measure | Current state | Meaning |
|---|---:|---|
| Planned Framework Packs drafted | 20 / 20 | The intended first-pass breadth exists. |
| Framework Cards | 199 | All current concepts have a structured handoff form. |
| Catalogued sources | 270 | Sources are catalogued; this does not prove truth or predictive usefulness. |
| Public-source-paraphrase rights | 180 / 199 | 19 Cards still require source or rights review. |
| Practical Framework Pack v1 estimate | 80–85% | Suitable for research questions, evidence requests, advisory lenses, counterevidence, and disagreement-preserving reports. |
| Content-approved or published Cards | 0 / 199 | No named framework is ready for public product claims. |
| Validated decision factors | 0 / 199 | No Card may carry formal investment-decision weight. |

The 80–85% figure is a qualitative reviewer estimate for an advisory content
pack. It is not a coverage probability, predictive-accuracy claim, runtime
score, or publication status.

## Source received and reviewed

### Metrick / Yasuda third-edition SSRN excerpt

- Title: *Venture Capital and the Finance of Innovation*, third edition.
- Public record: `https://papers.ssrn.com/sol3/papers.cfm?abstract_id=929145`
- Reviewed artifact: 36-page authorized public excerpt.
- SHA-256:
  `aec0815b2b2213a8c6ab9510d1e9c05835d36901b62bd79a102bad79996a4709`
- Included: front matter, authors, preface, brief contents, and complete
  Chapter 1.
- Useful for: third-edition identity and architecture, VC definition,
  investing/monitoring/exiting scope, historical market patterns, and
  `VCFI-01`.
- Not included: the substantive methods in Chapters 3–4 and 7–24.
- Blockers resolved: none.
- Still pending: `VCFI-03` through `VCFI-10`.

The PDF itself is copyrighted and must not be committed. Only its public URL,
metadata, hash, neutral paraphrase, and exact locators belong in Git.

## Tier A — obtain first

These sources have the highest impact on formula, process, or book-specific
fidelity.

1. *Venture Capital and the Finance of Innovation*, third edition — Andrew
   Metrick and Ayako Yasuda. The current file contains only Chapter 1; the
   remaining chapters are still needed.
2. *The Business of Venture Capital*, third edition — Mahendra Ramsinghani.
3. *Expectations Investing*, Revised and Updated — Michael Mauboussin and
   Alfred Rappaport.
4. *Venture Deals*, fourth edition — Brad Feld and Jason Mendelson.
5. *The Founder’s Dilemmas* — Noam Wasserman.
6. *Scaling People* — Claire Hughes Johnson.
7. *Obviously Awesome*, Updated and Expanded second edition, plus its
   subscriber workbook — April Dunford.
8. *7 Powers: The Foundations of Business Strategy* — Hamilton Helmer.
9. *Super Founders* — Ali Tamaseb.
10. *The Venture Mindset* — Ilya Strebulaev and Alex Dang.
11. *Secrets of Sand Hill Road* — Scott Kupor.

The Cards currently blocked most directly by missing source access are:

- `OA2-08`;
- `BVC-02`, `BVC-03`, `BVC-04`, `BVC-05`, `BVC-09`;
- `VCFI-03` through `VCFI-10`;
- `FD-02`, `FD-04`, `FD-06`, `FD-07`, `FD-10`.

## Tier B — obtain later

These books would improve chapter-level fidelity and exact locators, but the
authors already provide enough direct public material for a safe first draft.

1. *Zero to One* — Peter Thiel and Blake Masters.
2. *The Dark Side of Valuation*, third edition — Aswath Damodaran.
3. *Narrative and Numbers* — Aswath Damodaran.
4. *The Most Important Thing Illuminated* — Howard Marks.

## Not currently required

- *The Cold Start Problem*: an author-hosted public PDF supports the current
  draft.
- *The Power Law*: the pack is historical and advisory; public author
  interviews are sufficient for v1.
- Marc Andreessen, Bill Gurley, and Sequoia / Don Valentine / Michael Moritz:
  their direct public essays, talks, interviews, and institutional materials
  support the current first pass.

## Safe acquisition and handoff

When the user supplies a lawfully acquired PDF or EPUB:

1. keep the source file private and outside Git;
2. confirm title, edition, revision, and file hash;
3. review only the chapters relevant to declared Cards;
4. record exact chapter/page locators;
5. replace source summaries with neutral, non-substitutive paraphrases;
6. record exceptions, counterexamples, applicability, and contraindications;
7. update rights and content-review status without assuming publication rights;
8. leave formal decision weight at zero until independent validation.

Private access improves Framework Fidelity. It does not create permission to
redistribute the book, imitate a person, expose private chain of thought, or
claim predictive investment validity.
