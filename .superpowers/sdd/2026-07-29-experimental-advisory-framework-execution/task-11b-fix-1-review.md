# Independent Fix Re-review — Experimental Advisory Framework Execution

Reviewed fix commit: `80aba110b11b56cd66685a90466cab9f0b682e44`

Reviewed range: `007c524..80aba11`

Binding amendment:
`docs/superpowers/specs/2026-07-29-experimental-advisory-framework-amendment.md`

Original review:
`.superpowers/sdd/2026-07-29-experimental-advisory-framework-execution/task-11b-review.md`

## Verdicts

- **Spec compliance: APPROVED for Task 11b**
- **Code quality: APPROVED**
- **New finding count: 0 Critical / 0 Important / 0 Minor**

All five original findings are addressed. The remaining production
worker/catalog connection is a known Task 13 cross-branch integration seam,
not a defect in this Task 11b fix. It does not prevent Task 11b approval now,
but the merged release must complete that seam before claiming that production
candidate runs execute and render the named advisory catalog end to end.

## Original finding disposition

### C1 — ADDRESSED

Production authorization is now tied to the module-relative checked-in
`research/framework-authoring` root, exact 20 / 199 / 270 corpus counts, exact
180 / 19 eligibility counts, and the pinned full parsed-corpus digest
`sha256:5144000c0f34c5c352f9bc886460cd561a52b45da31049f00d7fbf6115e3a8bb`
(`research-loader.ts:77-89`, `184-220`).

Caller-selected roots require explicit `validation_only` mode and are never
entered into the authorization registry (`research-loader.ts:58-69`,
`117-127`, `219-243`). The corpus digest covers every parsed pack manifest,
every Card including excluded Cards, and every complete source catalog through
the sorted `loadedPacks` value (`research-loader.ts:151-187`).

Adversarial confirmation went beyond the one-pack fixture: an exact copied
20 / 199 / 270 corpus produced the pinned digest but remained
`validation_only`; its first composite failed
`isAuthorizedResearchComposite`, and `authorizedResearchComposites` rejected
the catalog. Therefore neither matching counts nor matching content/digest at
a custom root grants execution authority.

The module-relative root avoids process-working-directory brittleness.
Changing audited content intentionally requires updating the pinned digest;
that is the required authorization ceremony, not an accidental runtime
dependency.

### C2 — ADDRESSED

Unauthorized experimental Cards now abstain before cache lookup, cache write,
or provider I/O (`service.ts:258-305`; cache lookup begins at `318`).

Authorized cache records are strict-schema parsed and checked against:

- the requested record and judgment fingerprints;
- deterministic judgment ID and exact Card ID/version;
- Candidate ID and analysis fingerprint;
- Evidence Pack ID/version;
- context ID/version;
- execution provider/model/prompt/schema/settings/application commit;
- authorization mode, catalog fingerprint, corpus digest, and composite
  authorization digest;
- exact loader-owned advisory metadata; and
- an exact sorted Evidence Pack partition with the expected typed claim edges.

The relevant enforcement is in `service.ts:110-148`, `521-680`; Candidate,
Evidence Pack, complete context, Card, execution settings, and authorization
material are also included in the execution fingerprint at
`service.ts:683-713`.

Focused probes confirmed that an unauthorized clone performs zero cache finds,
zero cache saves, and zero provider calls; a candidate-rebound record and
corrupt advisory metadata both fail closed. Distinct Candidate and context
identities produce distinct calls/fingerprints. No prompt or raw provider
response field was added to the cache schema.

### C3 — ADDRESSED

The decision engine now filters parsed judgments before rule evaluation. A
formal input must both lack experimental advisory metadata and match an exact
Card ID/version pair from the product-owned synthetic Framework Pack
(`decision/engine.ts:24-26`, `109-160`).

Because this filtering precedes both mandatory selection and the specialist
scan in `decision/rules.ts:416-454`, a zero-weight advisory is excluded
regardless of whether its `frameworkCardId` collides with a mandatory or
specialist ID. The mandatory collision regression remained byte-for-byte equal
to the positive baseline, and the ordinary synthetic baseline still produced
`Invest Candidate`. The filter also prevents excluded advisory judgment IDs
from entering formal fired-rule inputs or decision claim edges.

### I1 — ADDRESSED for Task 11b; Task 13 integration seam remains

The shared renderer now preserves the required named advisory output:

- pack name/ID/version, source catalog and research cutoff;
- named component attribution and component Card ID/version;
- visible formal decision weight zero;
- product-synthesis, no-endorsement, and no-private-reasoning notices;
- support, counterevidence and exact Evidence Pack IDs;
- unknowns and limitations;
- independent conflicts; and
- source ID/URL/title/publisher/revision plus exact locator and component
  lineage.

This is implemented in `advisory-rendering.ts:11-207` and is consumed by the
Company Underwriting narrative (`narrative.ts:47-78`) and only the
`internal_memo` and `dd_request` draft bodies
(`action-drafts.ts:67-81`, `120-150`). Email, SMS, and LinkedIn bodies remain
unchanged. These modules only parse and render saved artifacts; the fix adds no
addressing, delivery, send, publish, network, or provider capability.

The focused narrative and draft probes retained attribution/version/notices,
zero weight, support/counterevidence, unknowns/limitations, independent
conflicts, and pack → Card → source → exact-locator lineage.

The still-unmerged Task 13 commit `caf95aa` has the production orchestration
call sites. At integration time it must:

1. replace the worker's context-free singleton
   `createFrameworkLensService(...)` with a context-keyed catalog/service
   factory that calls `loadResearchFrameworkCatalog({ context })` and reuses
   the service for the same immutable context;
2. keep the already-present `lensResult.judgments` and
   `lensResult.disagreements` arguments to `buildUnderwritingNarrative`; and
3. pass those same two values to
   `createActionDraftGenerator(...).generate(...)`.

Task 13 already persists judgments, disagreements, narrative, and drafts in
the finalization payload. Completing these three wiring changes is required
for the merged production flow, and no send/publish action should be added.
Because that worker/orchestrator commit is deliberately outside this isolated
Task 11b fix branch, this seam does not prevent Task 11b task approval now.

### I2 — ADDRESSED

The service owns an in-flight registry keyed by the complete execution
fingerprint (`service.ts:218-221`). Cache lookup, provider execution, grounding,
and persistence share the same promise, and identity-guarded cleanup runs on
both fulfillment and rejection (`service.ts:314-442`, `453-469`).

Focused probes confirmed:

- two concurrent identical executions make one provider call;
- two concurrent full-catalog runs make 19 calls rather than 38;
- both callers observe a shared failed cache write;
- the failed fingerprint is removed and can retry successfully; and
- different Candidate or context identities do not coalesce.

The cleanup does not retain completed/rejected promises, and the identity
check prevents an older promise from deleting a newer retry entry.

## Focused verification

Selected adversarial regression command:

```text
12 tests passed
0 failed
```

It covered exact-catalog object authorization, custom-root non-authorization,
authorization before caller cache, corrupt advisory metadata, candidate
rebinding, concurrent coalescing, failed-write cleanup/retry, Candidate/context
isolation, mandatory-ID collision, narrative lineage/conflicts, and draft-only
diligence rendering.

Decision boundary confirmation:

```text
synthetic positive baseline: Invest Candidate
mandatory-ID zero-weight advisory collision: identical baseline
2 tests passed
0 failed
```

Additional exact-corpus custom-root probe:

```text
stats:                 20 / 199 / 270 / 180 / 19
digest:                pinned digest matched
authorization mode:    validation_only
composite authorized:  false
authorization API:     rejected
```

`git diff --check 007c524..80aba11` passed. No product code was modified by
this review.
