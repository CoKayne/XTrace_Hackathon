# Task 4 Review Fix Round 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct replay-version exposure, exact financial calculation lineage,
and public-demo document links while adding real interaction/API coverage.

**Architecture:** Keep the existing VSee components and routes. Promote the
persisted Candidate Version Snapshot schema as the shared public DTO, derive
financial lineage only from a unique persisted Calculation whose formula,
encoded output identity, output value, and valuation membership all match, and
branch Deal links by explicit deployment mode. Extract only the two async UI
interaction boundaries needed for real route-backed tests.

**Tech Stack:** TypeScript 5.9, React 19, Node test runner, Zod 4, Vinext.

## Global Constraints

- Preserve the current VSee design and legacy report/local-draft behavior.
- Product controls remain server-capability gated; public demo remains
  read-only.
- Never fabricate replay lineage or a Source Revision identity.
- Action Draft Save sends exactly `{ body }` and has no delivery side effect.
- Use RED/GREEN TDD for every production behavior change.

---

### Task 1: Return and render exact replay lineage

**Files:**
- Modify: `lib/underwriting/read-model.ts`
- Modify: `app/underwriting-view-model.ts`
- Modify: `app/underwriting-detail.tsx`
- Test: `tests/integration/underwriting-report-route.test.ts`
- Test: `tests/unit/underwriting-view-model.test.ts`
- Test: `tests/unit/ui-hardening.test.ts`

**Interfaces:**
- Consumes: persisted `CandidateVersionSnapshotSchema`.
- Produces: shared `PublicCandidateVersionSnapshotSchema` and exact version
  rows for model, prompt, settings, and application commit.

- [x] **Step 1: Write the failing API and rendered-output tests**

Assert the candidate API returns these hand-derived values:

```ts
{
  providerModel: "private-provider-model",
  promptVersion: "private-prompt-version",
  settingsFingerprint: "private-settings-fingerprint",
  applicationCommit: "private-application-commit",
}
```

Assert version rows and candidate HTML display the same values.

- [x] **Step 2: Run the focused tests and verify RED**

Run:

```bash
node --import tsx --test \
  tests/integration/underwriting-report-route.test.ts \
  tests/unit/underwriting-view-model.test.ts \
  tests/unit/ui-hardening.test.ts
```

Expected: API assertions receive missing fields and UI rows still say
`Not exposed by server`.

- [x] **Step 3: Implement the minimal shared DTO and rendering**

Alias the complete strict persisted schema as the public version schema, parse
the cloned persisted snapshot through it, import the inferred shared type in
the UI, and render the four exact values.

- [x] **Step 4: Rerun the focused tests and verify GREEN**

Run the Step 2 command. Expected: all pass.

### Task 2: Map each financial value to its exact Calculation

**Files:**
- Modify: `app/underwriting-view-model.ts`
- Modify: `app/underwriting-detail.tsx`
- Test: `tests/unit/underwriting-view-model.test.ts`
- Test: `tests/unit/ui-hardening.test.ts`

**Interfaces:**
- Produces:

```ts
financialCalculationLineage({
  field,
  value,
  calculations,
  valuationCalculationIds,
}): { kind: "Calculation"; itemId: string } | null
```

- [x] **Step 1: Write failing identity/value mapping tests**

Use five literal Calculation fixtures whose IDs end in:

```text
venture_return_method_v1:maximum_acceptable_pre_money
simple_pre_post_ownership_v1:initial_ownership
future_dilution_v1:post_dilution_ownership
gross_deal_moic_v1:gross_moic
annualized_gross_irr_v1:gross_irr
```

Assert each financial field returns only its own ID. Assert a wrong output,
missing valuation membership, duplicate match, or absent Calculation returns
`null`.

- [x] **Step 2: Run view-model tests and verify RED**

Run:

```bash
node --import tsx --test \
  tests/unit/underwriting-view-model.test.ts \
  tests/unit/ui-hardening.test.ts
```

Expected: desired mapper export is missing and rendered cards use the first
Calculation.

- [x] **Step 3: Implement the minimal exact mapper**

Match all of:

```text
valuation membership + formulaId + encoded output-field suffix
+ exact output value
```

Return a lineage only for one unique match. Replace every first-calculation
fallback and show no details link when no exact match exists. Preserve the
Calculation's persisted status rather than treating status as identity.

- [x] **Step 4: Rerun Step 2 and verify GREEN**

Expected: each card renders its own exact Calculation chain or no link.

### Task 3: Preserve public-demo document links

**Files:**
- Modify: `app/page.tsx`
- Test: `tests/unit/ui-hardening.test.ts`

**Interfaces:**
- Public demo Deal: uses its existing `/api/documents/:id/access#page=N`.
- Product Deal: uses each `/api/source-revisions/:id/access`.

- [x] **Step 1: Write the failing user-visible route test**

Build the real demo view model, render the Deal backed by `doc_100plus`, assert
its visible anchor targets `/api/documents/doc_100plus/access`, and invoke the
real public document-access route to assert its guarded redirect.

- [x] **Step 2: Run the UI test and verify RED**

Run:

```bash
node --import tsx --test tests/unit/ui-hardening.test.ts
```

Expected: rendered href incorrectly targets
`/api/source-revisions/doc_100plus/access`.

- [x] **Step 3: Branch link rendering by deployment mode**

Render the supplied document link unchanged in public demo. Instantiate
`SourceRevisionLink` only for product `sourceLinks`.

- [x] **Step 4: Rerun Step 2 and verify GREEN**

Expected: the demo document link and product Source Revision tests both pass.

### Task 4: Exercise real UI interaction boundaries

**Files:**
- Modify: `app/action-draft-dialog.tsx`
- Modify: `app/source-revision-link.tsx`
- Test: `tests/integration/action-drafts-route.test.ts`
- Test: `tests/integration/upload-confirmation-flow.test.ts`

**Interfaces:**
- Produces `saveActionDraftBody(...)` used by the Save event.
- Produces `openSourceRevision(...)` used by the link event.

- [x] **Step 1: Write failing route-backed interaction tests**

Invoke the desired production Save interaction through the real Action Draft
PATCH route and memory repository, then assert the same draft identity has the
new body. Invoke the desired Source Revision interaction through the real
scoped access route and assert the issued URL is passed to the browser-opening
boundary.

- [x] **Step 2: Run both integration suites and verify RED**

Run:

```bash
node --import tsx --test \
  tests/integration/action-drafts-route.test.ts \
  tests/integration/upload-confirmation-flow.test.ts
```

Expected: desired interaction exports are absent.

- [x] **Step 3: Extract and wire the minimal async interactions**

Keep API request/browser opening injectable only at the external boundary.
The React event handlers call these exact functions; no test-only production
method is added.

- [x] **Step 4: Rerun Step 2 and verify GREEN**

Expected: route-backed Save and guarded Source Revision opening pass.

### Task 5: Verify, review, report, and commit

**Files:**
- Modify:
  `.superpowers/sdd/2026-07-29-end-to-end-continuation/task-4-report.md`
  in the backend checkpoint worktree.

- [x] **Step 1: Run focused and full verification**

Run:

```bash
node --import tsx --test \
  tests/unit/underwriting-view-model.test.ts \
  tests/unit/ui-hardening.test.ts \
  tests/unit/report-draft.test.ts \
  tests/integration/underwriting-report-route.test.ts \
  tests/integration/action-drafts-route.test.ts \
  tests/integration/upload-confirmation-flow.test.ts \
  tests/integration/product-deal-read-model.test.ts
npm run typecheck
npm run lint
npm run test:legacy
npm test
```

- [x] **Step 2: Review the complete fix diff**

Confirm no replay field is fabricated, no financial card uses a generic first
Calculation, public demo emits no revision route for a document ID, product
revision access remains guarded, and draft interaction still sends only
`{ body }`.

- [x] **Step 3: Commit and append the Task 4 report**

Commit the feature worktree, then append RED/GREEN evidence, verification,
self-review, concerns, and the exact fix commit hash to `task-4-report.md`.
