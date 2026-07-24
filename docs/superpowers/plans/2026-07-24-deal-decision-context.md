# Complete Deal Decision Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every fixed-corpus Deal deterministic, visibly synthetic VC decision context and carry that context through the product’s memory, retrieval, matching, and presentation paths.

**Architecture:** The fixed corpus remains the source of company facts, while `DEMO_FIXTURES` remains the separate source of synthetic internal judgment. A required `decisionReason` field is added to the shared interaction contract, mapped into every Deal memory bundle, and propagated without model rewriting through API view models, search/chat sources, matching context, XTrace serialization, and the Deals UI.

**Tech Stack:** TypeScript, Zod, React/Next.js-compatible Vinext app, Node test runner, XTrace memory service.

## Global Constraints

- Preserve all unrelated dirty work in `.env.example`, `lib/claude/client.ts`, `lib/xtrace/service.ts`, `tests/unit/xtrace-service.test.ts`, and `tests/unit/claude-client.test.ts`.
- Decision records must retain `provenance: "demo_fixture"` and the permanent Hackathon demo label.
- Do not invent customers, revenue, funding, regulatory approvals, metrics, or outside events.
- Runtime Claude calls must not generate or rewrite historical decision context.
- The mixed public-market-source subsystem is outside this change.

---

## Task 1: Complete the Decision Context Contract and Fixture Corpus

**Files:**

- Modify: `tests/unit/corpus.test.ts`
- Modify: `tests/unit/demo-view-model.test.ts`
- Modify: `lib/contracts/domain.ts`
- Modify: `lib/corpus/fixtures.ts`
- Modify: `lib/corpus/service.ts`
- Modify: `lib/demo/view-model.ts`
- Modify: `tests/integration/xtrace-live.test.ts`
- Modify: `tests/unit/matching-reasoner.test.ts`
- Modify: `tests/unit/xtrace-service.test.ts`

- [x] **Step 1: Strengthen corpus tests before production code**

Update the synthetic-record test to require:

```ts
assert.equal(DEMO_FIXTURES.length, 19);
assert.equal(new Set(DEMO_FIXTURES.map((fixture) => fixture.dealId)).size, 19);
assert.deepEqual(
  new Set(DEMO_FIXTURES.map((fixture) => fixture.dealId)),
  new Set(
    listPreloadedDocuments()
      .filter((document) => document.role === "deal_document")
      .flatMap((document) => listDocumentDeals(document).map((deal) => deal.dealId)),
  ),
);
for (const fixture of DEMO_FIXTURES) {
  assert.ok(fixture.decisionReason.trim());
  assert.ok(fixture.concerns.every((value) => value.trim()));
  assert.ok(fixture.revisitConditions.every((value) => value.trim()));
  assert.ok(fixture.meetingSummary.trim());
}
```

Update the demo view-model test to require `fixtureDeals === 19` and a non-empty `decisionReason` for every Deal.

- [x] **Step 2: Run the focused tests and confirm they fail**

Run:

```bash
npm test -- tests/unit/corpus.test.ts tests/unit/demo-view-model.test.ts
```

Expected: failure because there are only four fixtures and `decisionReason` does not exist.

- [x] **Step 3: Add the required shared field**

Add `decisionReason: z.string().min(1)` to `DealInteractionSchema`.

Add `decisionReason: string` to `DemoFixture`.

Add `decisionReason` to every inline `DealInteraction` test object so TypeScript and schema validation remain explicit.

- [x] **Step 4: Add deterministic company-specific fixtures for all 19 Deals**

Keep the existing four statuses and use the approved status distribution for the remaining fifteen. Every fixture must have a unique ID, deterministic timestamp, source-supported company proposition, concise synthetic decision reason, one or more Partner concerns, one or more revisit conditions, and a previous-meeting summary.

Use only facts present in `lib/corpus/evidence.ts`. Phrase unsupported business judgments as internal questions or evidence thresholds.

- [x] **Step 5: Map the field into memory bundles and view models**

In `createMemoryBundle`, add:

```ts
decisionReason: fixture.decisionReason,
```

Add `"decisionReason"` to the fixture `Pick` in `DemoDealView` and include it in `buildDemoViewModel`.

- [x] **Step 6: Run focused tests**

Run:

```bash
npm test -- tests/unit/corpus.test.ts tests/unit/demo-view-model.test.ts
npm run typecheck
```

Expected: all pass.

- [x] **Step 7: Commit this batch**

```bash
git add lib/contracts/domain.ts lib/corpus/fixtures.ts lib/corpus/service.ts lib/demo/view-model.ts tests/unit/corpus.test.ts tests/unit/demo-view-model.test.ts tests/integration/xtrace-live.test.ts tests/unit/matching-reasoner.test.ts tests/unit/xtrace-service.test.ts
git commit -m "feat: complete synthetic deal decision context"
```

---

## Task 2: Propagate Decision Reasons Through Retrieval, Matching, and XTrace

**Files:**

- Modify: `tests/unit/demo-search.test.ts`
- Modify: `tests/unit/matching-reasoner.test.ts`
- Modify: `tests/unit/xtrace-service.test.ts`
- Modify: `lib/demo/search.ts`
- Modify: `app/api/chat/route.ts`
- Modify: `app/api/deals/route.ts`
- Modify: `lib/matching/context.ts`
- Modify: `lib/xtrace/service.ts`

- [x] **Step 1: Add failing propagation tests**

Add assertions that:

- search can match a phrase appearing only in a fixture’s `decisionReason`;
- search/chat source excerpts contain a `Decision reason:` line;
- structured matching context contains `decision_reason`;
- serialized XTrace content contains `decision_reason=`.

- [x] **Step 2: Run the focused tests and confirm they fail**

Run:

```bash
npm test -- tests/unit/demo-search.test.ts tests/unit/matching-reasoner.test.ts tests/unit/xtrace-service.test.ts
```

Expected: new assertions fail because the field is not yet propagated.

- [x] **Step 3: Add the field to Deal filtering and search context**

Add `deal.fixture?.decisionReason` to the Deal API search haystack.

Add a `Decision reason: ${fixture.decisionReason}` line to synthetic source excerpts and add the field to the query haystack in `lib/demo/search.ts`.

Add the same source-excerpt field in `app/api/chat/route.ts`.

- [x] **Step 4: Add the field to matching and XTrace serialization**

In matching context, emit:

```text
decision_reason: ...
```

and include the decision reason in the corresponding synthetic source excerpt.

In `serializeBundle`, add:

```text
decision_reason=...
```

while preserving the existing uncommitted provenance fix in `lib/xtrace/service.ts`.

- [x] **Step 5: Run focused tests**

Run:

```bash
npm test -- tests/unit/demo-search.test.ts tests/unit/matching-reasoner.test.ts tests/unit/xtrace-service.test.ts
npm run typecheck
```

Expected: all pass.

- [x] **Step 6: Commit this batch without unrelated files**

Stage only the relevant hunks. Do not stage the Opus model changes or unrelated XTrace provenance changes.

```bash
git add app/api/chat/route.ts app/api/deals/route.ts lib/demo/search.ts lib/matching/context.ts tests/unit/demo-search.test.ts tests/unit/matching-reasoner.test.ts
git add -p lib/xtrace/service.ts tests/unit/xtrace-service.test.ts
git commit -m "feat: propagate deal decision reasons"
```

---

## Task 3: Render Complete Context in the Deals UI

**Files:**

- Create: `lib/demo/decision-label.ts`
- Create: `tests/unit/decision-label.test.ts`
- Modify: `app/page.tsx`
- Modify: `app/vsee.css`

- [x] **Step 1: Write a failing status-label test**

Create a test for:

```ts
decisionReasonLabel("passed") === "Pass reason"
decisionReasonLabel("invested") === "Investment rationale"
decisionReasonLabel("screening") === "Decision reason"
decisionReasonLabel("watchlist") === "Decision reason"
decisionReasonLabel("evaluating") === "Decision reason"
```

- [x] **Step 2: Run the focused test and confirm it fails**

Run:

```bash
npm test -- tests/unit/decision-label.test.ts
```

Expected: module-not-found failure.

- [x] **Step 3: Implement the status-sensitive label helper**

Create `decisionReasonLabel(status: DealStatus): string` with the exact labels from the approved design.

- [x] **Step 4: Render all four context components**

Extend the local UI fixture type with `decisionReason`.

Keep the existing synthetic fixture label visible and render:

- status-sensitive rationale label and `decisionReason`;
- `Partner concern` and all concerns;
- `Revisit condition` and all revisit conditions;
- `Previous meeting summary` and `meetingSummary`.

Keep the existing visual language and Deal layout; only add compact internal-context styling.

- [x] **Step 5: Run UI and type verification**

Run:

```bash
npm test -- tests/unit/decision-label.test.ts
npm run typecheck
npm run build
```

Expected: all pass.

- [x] **Step 6: Commit this batch**

```bash
git add lib/demo/decision-label.ts tests/unit/decision-label.test.ts app/page.tsx app/vsee.css
git commit -m "feat: show complete VC decision context"
```

---

## Task 4: Full Regression Verification

**Files:**

- Inspect: `README.md`
- Inspect: `docs/**/*.md`
- Modify only if an existing count or behavior statement is now incorrect.

- [x] **Step 1: Search for stale four-fixture language**

Run:

```bash
rg -n "four fixtures|4 fixtures|four labeled|4 labeled|fixtureDeals|labeled VC decisions" README.md docs app lib tests
```

Correct only statements that describe the implemented fixture count.

- [x] **Step 2: Run the full verification suite**

Run:

```bash
npm test
npm run lint
npm run typecheck
npm run build
git diff --check
```

Expected: all commands exit successfully.

- [x] **Step 3: Review the final diff**

Confirm:

- all 19 Deals have source-backed fixture mappings;
- all synthetic fields remain visibly labeled;
- no runtime model-generated decision history was introduced;
- unrelated dirty files and hunks were not committed;
- no API keys or local credentials appear in the diff.

- [x] **Step 4: Commit any verification-only documentation correction**

If documentation required correction:

```bash
git add README.md docs
git commit -m "docs: align demo decision context"
```

