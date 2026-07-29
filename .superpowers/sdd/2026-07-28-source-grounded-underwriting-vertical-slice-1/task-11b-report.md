# Task 11b Report — Real Distilled Advisory Framework Execution

## Outcome

Implemented the experimental advisory amendment so the checked-in named
research frameworks now produce real, complete, source-grounded opinions in
the underwriting flow. They are no longer decorative research artifacts.

The runtime now:

- strictly validates and loads all 20 audited research packs, 199 Framework
  Cards, and 270 source records;
- admits exactly the 180 Cards with
  `public_source_paraphrase` / `draft` / `unpublished` / formal weight `0`;
- excludes all 19 `pending_review` Cards before prompt construction;
- context-filters the eligible Cards across stage, business model, geography,
  and security type;
- composes each pack into one immutable advisory lens, for at most 20 named
  lens calls rather than 199 Card calls;
- executes the exact Task 7 core first and appends at most 20 advisory pack
  judgments in stable order;
- uses a default bounded provider concurrency of exactly four;
- gives every applicable named lens one provider attempt, with malformed,
  truncated, or failed output becoming `unavailable` / `abstain`, never
  negative company evidence;
- persists complete support, counterevidence, unused evidence, unknowns,
  limitations, five confidence dimensions, component Cards, source records,
  exact source locators, and governance notices;
- preserves opposing named opinions as
  `independent_framework_conflict`; and
- keeps every named advisory at literal formal decision weight `"0"`, so it
  cannot alter the deterministic investment decision.

No deterministic Task 12 decision-engine implementation file was modified.

## Audited loader and authorization boundary

`research-loader.ts` uses Node-only filesystem and crypto APIs. It validates:

- strict Pack manifest, Card, and source-catalog shapes;
- one manifest and one source catalog per author directory;
- exact declared-versus-present Card file sets;
- real files and directories rather than symlinks;
- safe relative paths contained beneath the audited author/root directories;
- globally unique Pack, Card, catalog, and source identities;
- locally unique source identities; and
- resolution of every Card source reference inside its own audited pack.

The real Seed / B2B SaaS / US / Preferred load proves:

```text
packs:     20
Cards:    199
sources:  270
eligible: 180
excluded:  19
```

Every pack produces one deeply frozen composite, including a zero-component
non-applicable composite when no accepted Card matches the context. The
fingerprint binds the exact manifest, context, accepted component content,
source records, source locators, and notices.

Authorization is object-identity based in a module-private registry. A
structured clone of a catalog or Card cannot execute. Authorized-catalog and
unauthorized-input fingerprints are also separated, so a lookalike cannot
replay an authorized cached judgment. Untrusted lookalike metadata is not
retained on its abstention.

## Real pack-level opinion flow

Each applicable pack prompt contains exactly one composite and the immutable
Evidence Pack. It retains the accepted components' complete neutral
paraphrases, evidence requirements, questions, rules, signals, red flags,
disconfirming evidence, contraindications, empirical qualifications, source
IDs, source URLs, and exact locators.

For example, the Peter Thiel research composite retains `PT-01` and its
testable contrarian-thesis method, including:

- the six decision questions;
- five positive signals;
- six red flags;
- five disconfirming-evidence tests;
- four contraindications;
- source `PT-P2-CS183-01`; and
- locator `Three questions and contrarian/business question`.

The persisted judgment keeps that complete loader-owned metadata beside the
model's company opinion. The provider may cite only exact Evidence Pack Fact
and Assumption IDs. Advisory prompts never receive saved Calculations and the
strict output has no browsing, tool, recalculation, decision, veto, ceiling,
send, or publish field.

The focused real-corpus execution proves:

```text
named judgments returned:             20
applicable pack provider calls:        19
zero-component pre-call abstentions:    1
maximum concurrent provider calls:      4
repeat calls for identical cache run:   0
advisory attempts after invalid output: 1
```

One test also runs an exact Task 7 core Card plus the complete advisory
catalog. The returned order is the core judgment followed by the 20 stable
pack judgments.

## Downstream-consumable output

Successful named judgments retain:

- applicability and bounded conclusion;
- strongest supporting Evidence Pack item and grounded text;
- strongest counterevidence item and grounded text;
- the exact unused evidence partition;
- explicit unknowns and limitations;
- five independent confidence dimensions;
- typed Fact / Assumption claim edges;
- the one composite Framework reference;
- pack name, version, review state, and research cutoff;
- every accepted component Card and its content;
- every referenced source record and exact locator;
- no-endorsement and no-private-reasoning notices; and
- literal formal decision weight `"0"`.

Authorized unavailable and non-applicable judgments retain the same research
metadata so reporting and diligence layers can explain which named lens
abstained and why.

Opposing applicable named judgments remain unchanged and are paired
deterministically as `independent_framework_conflict`, with both judgment IDs
and the stable union of their support and counterevidence. No average,
blended result, or invented consensus is created.

The existing decision-engine regression remains GREEN: an unselected named
advisory judgment is absent from formal rule inputs and cannot override an
otherwise fixed `Invest Candidate` result.

## TDD and self-review evidence

Observed RED failures before implementation included:

- the research loader module did not exist;
- grounded real-pack judgments lacked component/source metadata;
- the framework service returned zero advisory judgments and zero advisory
  calls;
- cloned catalogs were not rejected by the service;
- advisory failures still had the core repair behavior;
- named supportive/negative pairs produced no independent conflict; and
- a self-review regression showed that an unauthorized cloned Card could
  replay an already cached authorized judgment.

The final implementation makes each of those tests GREEN. The cache regression
was resolved by binding authorization mode and the exact authorized catalog
fingerprint into execution fingerprints, while still performing the
module-private identity check before replay.

## Verification

Fresh verification passed:

```text
Focused loader, advisory, grounding, lens, disagreement,
matching-reasoner, and decision-engine suite:
38 passed
0 failed

npm run typecheck:
passed

npm run lint:
passed with zero errors or warnings

git diff --check:
passed
```

An additional post-self-review authorization/cache regression and full
TypeScript check passed before the final verification rerun.

## Review and scope

The implementer completed a line-by-line self-review and fixed the
authorization/cache replay issue described above. Per root orchestration,
independent review is assigned after this implementation commit so the
implementer can release its concurrency slot.

Task 11b changes are limited to:

- research authoring/runtime schemas and the server-side loader;
- Framework Card and Judgment metadata contracts;
- grounding, prompting, execution, caching, and disagreements;
- Task 11b unit tests;
- the approved implementation plan; and
- this report.

Research JSON, deterministic Decision Policy code, Task 12 decision-engine
code, finalization repositories, migrations, narrative code, and external
action code were not modified.

## Independent-review fix round 1

The release-blocking findings in
`.superpowers/sdd/2026-07-29-experimental-advisory-framework-execution/task-11b-review.md`
were reproduced before correction and are now addressed.

### Canonical corpus authorization

Production authorization is now pinned to the checked-in
`research/framework-authoring` directory resolved from the loader module, not
the process working directory or a caller path. Authorization requires all of:

```text
packs:      20
Cards:     199
sources:   270
eligible:  180
excluded:   19
corpus:    sha256:5144000c0f34c5c352f9bc886460cd561a52b45da31049f00d7fbf6115e3a8bb
```

The corpus digest covers every parsed manifest, every Card including excluded
Cards, and every complete source catalog. Custom roots require explicit
`validation_only` mode and are never entered into the module-private
authorization registry. The one-pack Peter Thiel adversarial fixture still
validates as 1 / 10 / 23 / 10 / 0, but both authorization APIs reject it.

### Authorization-first, bound cache replay

An unauthorized experimental Card now abstains before cache lookup, cache
write, or provider I/O. Every authorized replay is strict-schema parsed and
must exactly match:

- the requested fingerprint and judgment fingerprint;
- Candidate ID and Candidate analysis fingerprint;
- Evidence Pack ID/version;
- context ID/version;
- Framework Card ID/version and deterministic judgment ID;
- execution provider/model/prompt/schema/settings/application commit;
- authorization mode, catalog fingerprint, complete-corpus digest, and
  composite authorization digest;
- the exact loader-owned advisory metadata; and
- the complete Evidence Pack partition and typed claim-edge set.

Malformed or mismatched records fail closed. Framework fingerprints now bind
Candidate identity as well as the full Evidence Pack, context, Card,
calculation scope, execution settings, and authorization material.

### Enforced decision isolation

The decision boundary now positively admits only exact ID/version pairs from
the published product-owned synthetic Framework Pack and excludes every
judgment carrying experimental advisory metadata before rule selection. This
is the narrowly authorized Task 12 change required by the review.

The regression uses real loader-produced advisory metadata with literal formal
weight `"0"` and deliberately collides its `frameworkCardId` with a mandatory
founder rule while retaining the original formal judgment. The result remains
byte-for-byte equal to the fixed `Invest Candidate` baseline, and the advisory
judgment is absent from formal claim edges.

### Concurrent same-fingerprint execution

A service-local in-flight registry now coalesces cache lookup, provider
execution, grounding, and cache persistence by the complete fingerprint. It
cleans up after both success and failure. Focused regressions prove:

```text
two concurrent identical one-Card runs: 1 provider call
two concurrent full-catalog runs:       19 calls, not 38
shared failed cache write:              both callers reject
retry after failed shared write:        succeeds with one new provider call
different Candidate/context identities: distinct fingerprints and calls
```

### Report and draft-only rendering

Company Underwriting narrative output now has explicit experimental advisory
opinion, independent advisory conflict, and advisory diligence sections.
Internal memo and diligence-request drafts consume the same persisted
judgments and disagreements. They visibly retain:

- pack, source-catalog, component Card, and source/locator lineage;
- pack/component versions and named attribution;
- support, counterevidence, Evidence Pack IDs, unknowns, limitations, and
  independent conflicts;
- product-synthesis, no-endorsement, and no-private-reasoning notices; and
- literal formal decision weight zero.

Email, SMS, and LinkedIn bodies are regression-tested unchanged. The generator
still creates editable drafts only and adds no addressing, delivery, send,
publish, or provider capability.

### Task 13 integration seam

Worker/orchestrator commit `caf95aa` was intentionally not merged into this
isolated fix branch. On integration with that commit:

1. replace the worker's context-free `createFrameworkLensService(...)`
   construction with a context-keyed service/catalog factory that calls
   `loadResearchFrameworkCatalog({ context })` and reuses a service for the
   same immutable context;
2. preserve the existing `lensResult.judgments` and
   `lensResult.disagreements` arguments already passed to
   `buildUnderwritingNarrative`; and
3. add those same two arguments to the Task 13
   `createActionDraftGenerator(...).generate(...)` call.

Task 13 already persists judgments, disagreements, narrative, and action
drafts in its finalization payload. No send or publish action should be added
at this seam.

### Fix-round verification

Observed RED before implementation:

```text
custom one-pack corpus authorized for execution
unauthorized advisory caller-cache lookup count: 1
corrupt advisory metadata replayed without rejection
mandatory-ID advisory collision threw/changed formal selection
two concurrent identical runs made 2 provider calls
one failed concurrent cache write rejected only 1 of 2 callers
required narrative/draft advisory sections absent
```

Fresh GREEN verification:

```text
Focused loader, advisory, grounding, lens, disagreement,
decision, narrative, and action-draft suite:
48 passed
0 failed

npm run typecheck:
passed

npm run lint:
passed with zero errors or warnings

git diff --check:
passed
```
