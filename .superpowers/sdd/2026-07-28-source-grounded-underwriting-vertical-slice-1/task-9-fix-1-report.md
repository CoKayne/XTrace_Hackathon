# Task 9 Fix 1 Report — Deterministic Fail-closed Context Routing

## Outcome

Closed both Important findings from `task-9-review.md` within the Task 9 Router
boundary.

The Router now:

- accepts an immutable dependency-availability snapshot for Critical Evidence
  Profiles and valuation policies;
- requires the exact selected profile and policy IDs to be published and to
  match the selected Stage × Business Model before returning `full` /
  `Invest Candidate`;
- returns Core-only with an `Advance` ceiling when either dependency is
  missing, draft, retired, or cohort-incompatible;
- uses known published Slice-1 v1 dependencies only for the no-argument
  production fixture;
- fails closed when callers supply custom contexts without an explicit
  availability snapshot;
- canonicalizes claims at the winning precedence; and
- preserves every same-value supporting `evidenceItemId`, globally
  deduplicated and UTF-8 sorted, so input permutations produce the same complete
  RouterResolution.

No Task 8 or Task 10 implementation was changed.

## Interface

`createContextRouter` now accepts:

```ts
referenceAvailability?: {
  criticalEvidenceProfiles: readonly {
    id: string;
    stage: "seed" | "series_a";
    businessModel: "b2b_saas" | "enterprise_ai";
    publicationStatus: "draft" | "published" | "retired";
  }[];
  valuationMethodPolicies: readonly {
    id: string;
    stage: "seed" | "series_a";
    businessModel: "b2b_saas" | "enterprise_ai";
    publicationStatus: "draft" | "published" | "retired";
  }[];
}
```

Availability is copied into exact published-reference key sets when the Router
is created, so later caller mutation cannot change routing behavior.

## TDD evidence

Dependency RED:

```text
Expected core_only
Actual full
```

The failing fixture used a compatible benchmark with missing or unpublished /
cohort-mismatched profile-policy availability.

Lineage RED:

```text
first evidenceItemIds contained stage:a
second evidenceItemIds contained stage:b
```

The two inputs contained the same equal-value, equal-priority evidence set in a
different order.

A mutation check also replaced the custom-context fail-closed default with the
known Slice-1 availability. The new regression failed with `full` instead of
`core_only`; restoring the fail-closed branch returned it to GREEN.

## Verification

Focused Router tests:

```text
7 passed, 0 failed
```

The full Task 9, evidence/underwriting contract, and Task 10 compatibility
suite result was:

```text
69 passed, 0 failed, 0 skipped
```

`npm run typecheck`, scoped Task 9 ESLint, and `git diff --cached --check` all
exited successfully before the fix was committed.
