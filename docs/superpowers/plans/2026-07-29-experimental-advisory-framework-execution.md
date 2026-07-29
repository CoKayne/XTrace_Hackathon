# Experimental Advisory Framework Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute the audited public-source research packs as at most twenty independent, source-retaining, zero-weight composite advisory lenses per candidate.

**Architecture:** A server-only loader validates every authoring manifest, Card, source catalog, relative path, source reference, and eligibility gate. It emits one deeply frozen, context-filtered composite per pack and records authorization in a module-private registry that caller-created lookalikes cannot reproduce. The existing framework service consumes those authorized composites alongside the exact Task 7 core cards, executes them through a four-worker bounded pool, persists strict grounded judgments with advisory metadata, and preserves opposing named judgments without feeding them into the deterministic decision matrix.

**Tech Stack:** TypeScript, Node filesystem/crypto APIs, Zod, Node test runner, existing Claude client and underwriting contracts.

## Global Constraints

- `docs/superpowers/specs/2026-07-29-experimental-advisory-framework-amendment.md` is authoritative.
- Research JSON is read-only and must not be rewritten.
- Exactly the eligibility tuple `public_source_paraphrase` / `draft` / `unpublished` / numeric weight `0` may enter a composite.
- Pending-review Cards must never enter a model prompt.
- One research pack produces one composite call, never one call per component Card.
- Default concurrency is exactly four and advisory execution performs at most one provider attempt per applicable pack.
- Advisory outputs have no browsing, tools, recalculation, formal decision, send, or publish capability.
- Existing Task 7 synthetic execution and one-repair behavior remain unchanged.
- Do not modify the deterministic Task 12 decision engine.

---

### Task 1: Validate and load the research catalog

**Files:**
- Create: `lib/underwriting/frameworks/research-schemas.ts`
- Create: `lib/underwriting/frameworks/research-loader.ts`
- Modify: `lib/underwriting/frameworks/schemas.ts`
- Create: `tests/unit/research-framework-loader.test.ts`

**Interfaces:**
- Consumes: `ResolvedUnderwritingContext` and a server-local research root.
- Produces:

```ts
export interface ResearchFrameworkCatalog {
  readonly context: Pick<
    ResolvedUnderwritingContext,
    "stage" | "businessModel" | "geography" | "securityType"
  >;
  readonly composites: readonly ExperimentalAdvisoryFrameworkCard[];
  readonly stats: {
    packCount: number;
    cardCount: number;
    sourceCount: number;
    eligibleCardCount: number;
    excludedCardCount: number;
  };
  readonly fingerprint: string;
}

export async function loadResearchFrameworkCatalog(input: {
  context: ResolvedUnderwritingContext;
  researchRoot?: string;
}): Promise<ResearchFrameworkCatalog>;
```

- Produces module-private authorization helpers used by the service:

```ts
export function authorizedResearchComposites(
  catalog: ResearchFrameworkCatalog,
): readonly ExperimentalAdvisoryFrameworkCard[];

export function isAuthorizedResearchComposite(
  catalog: ResearchFrameworkCatalog,
  card: FrameworkCard,
): card is ExperimentalAdvisoryFrameworkCard;
```

- [ ] **Step 1: Write the real-corpus failing test**

Load the checked-in research root for the Seed / B2B SaaS / US / Preferred
context and assert 20 packs, 199 Cards, 270 sources, 180 eligible Cards,
19 excluded Cards, twenty stable composite IDs, and no pending-review
component ID in any composite.

- [ ] **Step 2: Write path, schema, and source-reference failing tests**

Copy one author directory to a temporary research root, then independently
verify rejection of an unknown JSON field, `../` Card path, duplicate source
ID, and unresolved `sourceRef.sourceId`.

- [ ] **Step 3: Run the loader tests and verify RED**

Run:

```bash
node --import tsx --test tests/unit/research-framework-loader.test.ts
```

Expected: fail because `research-loader.ts` does not exist.

- [ ] **Step 4: Implement strict authoring schemas and safe filesystem loading**

Mirror both checked-in authoring JSON schemas with strict Zod objects. Add a
strict source-catalog schema covering all retained source and immutable
revision fields. Resolve each manifest-listed file beneath its author
directory, reject symlinks/traversal, require the manifest Card set to match
the directory Card set, enforce unique pack/Card/source IDs, and resolve every
Card source reference inside the same catalog.

- [ ] **Step 5: Implement eligibility, context filtering, composite projection, and authorization**

Filter the exact four eligibility fields before context matching. Match exact
stage; controlled B2B SaaS / Enterprise AI authoring aliases plus `all*`
business selectors; US to `united_states`; global only to `all*`; and
Preferred to `preferred`, `preferred_equity`, or `equity`. Ignore sector
because the immutable runtime context has no sector dimension.

Build one composite per pack, including a zero-component non-applicable
composite when necessary. Retain complete accepted component content and all
referenced source metadata/locators. Sort packs by UTF-8 pack ID and sources
by source ID. Fingerprint canonical exact inputs, deeply freeze the result,
and register the exact composite object identities in module-private Weak
collections.

- [ ] **Step 6: Run the loader tests and verify GREEN**

Run the Task 1 command and require zero failures.

---

### Task 2: Persist advisory metadata without widening decision authority

**Files:**
- Modify: `lib/contracts/underwriting.ts`
- Modify: `lib/underwriting/frameworks/schemas.ts`
- Modify: `lib/underwriting/frameworks/grounding.ts`
- Test: `tests/unit/framework-grounding.test.ts`
- Test: `tests/unit/research-framework-loader.test.ts`

**Interfaces:**
- Produces `FrameworkAdvisoryMetadataSchema`, containing pack identity,
  component content, source metadata, context, authorization digest, notices,
  and literal formal weight `"0"`.
- Extends `FrameworkJudgmentSchema` with optional
  `frameworkMetadata: FrameworkAdvisoryMetadata`.
- Extends `FrameworkCardSchema` as a union of the unchanged Task 7 synthetic
  card and `ExperimentalAdvisoryFrameworkCardSchema`.

- [ ] **Step 1: Write failing metadata and exact-reference tests**

Assert that an advisory judgment retains pack name/version, attribution,
component Card IDs/content, source URLs/locators, explicit no-endorsement and
no-private-reasoning notices, and only the composite Card ID as the
`framework_ref` claim edge.

- [ ] **Step 2: Run the tests and verify RED**

Expected: fail because the Card and judgment contracts do not accept advisory
metadata.

- [ ] **Step 3: Add strict advisory runtime schemas**

Use strict nested schemas and cross-field refinements so `componentCardIds`
exactly match the component records, every component source reference resolves
to retained source metadata, the context and composite ID are explicit, and
formal weight cannot differ from `"0"`.

- [ ] **Step 4: Attach loader-owned metadata during grounding and abstention**

The model continues to output only the existing strict grounded shape.
Grounding attaches the immutable advisory metadata server-side; neither model
text nor caller fields can create it. Facts and Assumptions remain the only
advisory evidence IDs. Calculations remain available only to the exact Task 7
valuation card.

- [ ] **Step 5: Run the tests and verify GREEN**

Run loader and grounding tests together and require zero failures.

---

### Task 3: Execute authorized composites with bounded concurrency and cache replay

**Files:**
- Modify: `lib/underwriting/frameworks/claude-lens.ts`
- Modify: `lib/underwriting/frameworks/service.ts`
- Create: `tests/unit/framework-advisory.test.ts`

**Interfaces:**
- Extends `createFrameworkLensService` options with:

```ts
advisoryCatalog?: ResearchFrameworkCatalog;
concurrency?: number; // integer 1..20, default 4
```

- [ ] **Step 1: Write the authorization and provider-bound failing tests**

Use the real catalog and a delayed fake client. Assert twenty advisory
judgments in stable pack order, zero calls for zero-component composites, at
most twenty valid-path provider calls, and no more than four simultaneous
calls. Assert every prompt contains one composite and no pending-review Card.

- [ ] **Step 2: Write cache, failure, and lookalike failing tests**

Assert a second identical run makes zero additional calls, cache inspection
contains no system/messages/raw response, a truncated or malformed advisory
response makes one call then saves an unavailable abstention, and a
caller-cloned advisory Card passed through ordinary `cards` cannot execute.

- [ ] **Step 3: Run advisory tests and verify RED**

Run:

```bash
node --import tsx --test tests/unit/framework-advisory.test.ts
```

Expected: fail because the service has no advisory catalog or bounded pool.

- [ ] **Step 4: Add mode-aware prompts and attempts**

For advisory composites, explicitly label product synthesis, public-source
attribution, zero decision weight, no endorsement, and no private reasoning.
Never include saved Calculations. Keep strict evidence partitioning and one
composite rule reference. Advisory failures stop after one attempt; Task 7
synthetic malformed output keeps exactly one repair.

- [ ] **Step 5: Add the bounded stable worker pool**

Combine parsed core cards followed by authorized composites sorted by pack ID.
Preallocate result slots, process with four workers by default, and return
judgments in input order regardless of completion order. Cache and persist
not-applicable/unavailable results identically to successful judgments.

- [ ] **Step 6: Run advisory and Task 11 tests and verify GREEN**

Run advisory, lens, grounding, loader, and matching-reasoner tests together.

---

### Task 4: Preserve opposing named opinions

**Files:**
- Modify: `lib/contracts/underwriting.ts`
- Modify: `lib/underwriting/frameworks/disagreements.ts`
- Modify: `tests/unit/framework-disagreement.test.ts`

**Interfaces:**
- Adds disagreement topic literal `independent_framework_conflict`.

- [ ] **Step 1: Write the failing advisory disagreement test**

Create two authorized composite judgments with opposite supportive/negative
conclusions. Assert stable output under reversed inputs, both original
judgments unchanged, both judgment IDs retained, grounded evidence union
retained, and no averaged or blended result.

- [ ] **Step 2: Run and verify RED**

Expected: fail because the topic and advisory pairing do not exist.

- [ ] **Step 3: Add deterministic advisory pairing**

After existing synthetic semantic rules, sort applicable advisory judgments
by Framework Card ID and create one conflict for every supportive/negative
pair. Ignore mixed, abstaining, unavailable, and non-applicable judgments.

- [ ] **Step 4: Run and verify GREEN**

Run disagreement plus all Task 11/11b focused tests.

---

### Task 5: Verify boundaries, review, report, and commit

**Files:**
- Create: `.superpowers/sdd/2026-07-28-source-grounded-underwriting-vertical-slice-1/task-11b-report.md`

**Interfaces:**
- No new runtime interface.

- [ ] **Step 1: Run fresh verification**

```bash
node --import tsx --test \
  tests/unit/research-framework-loader.test.ts \
  tests/unit/framework-advisory.test.ts \
  tests/unit/framework-grounding.test.ts \
  tests/unit/framework-lens.test.ts \
  tests/unit/framework-disagreement.test.ts \
  tests/unit/matching-reasoner.test.ts \
  tests/unit/decision-engine.test.ts
npm run typecheck
npm run lint
git diff --check
```

- [ ] **Step 2: Review every amendment acceptance criterion**

Confirm corpus counts, exact eligibility, one composite per pack, pre-call
context filtering, opaque loader authorization, cache replay, source/content
retention, disagreement preservation, prompt-free cache, and unchanged fixed
decision behavior.

- [ ] **Step 3: Request independent code review**

Give the reviewer the authoritative amendment, this plan, and the staged diff.
Resolve all Critical and Important findings before continuing.

- [ ] **Step 4: Write the Task 11b report**

Record RED/GREEN evidence, corpus counts, provider/concurrency bounds, source
retention, failure semantics, decision isolation, verification commands, and
the exact scope boundary.

- [ ] **Step 5: Stage only Task 11b files and commit once**

Use the agreed feature message:

```bash
git commit -m "feat(frameworks): execute real advisory research packs"
```
