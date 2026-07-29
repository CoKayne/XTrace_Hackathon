# Task 7 Fix Round 1 Report

## Scope

Fixed only the two Important findings in `task-7-review.md`:

1. Database-enforced immutability for every versioned underwriting reference
   table and the framework pack-card join.
2. Deterministic, version-aware Supabase context resolution with exact parity
   to the memory adapter's pinned Slice-1 v1 profiles.

No Task 5 privilege work, real named framework material, benchmark sourcing,
or unrelated feature work was added.

## Fix 1 — Append-only reference registries

Migration `0010_underwriting_references.sql` now installs the same
update/delete rejection trigger on all eleven append-only registry tables:

- `benchmark_packs`
- `benchmark_entries`
- `critical_evidence_profiles`
- `valuation_method_policies`
- `decision_policies`
- `framework_sources`
- `framework_cards`
- `framework_packs`
- `framework_pack_cards`
- `underwriting_contexts`
- `fund_policy_versions`

The active Fund Policy pointer remains mutable by design; immutable policy
versions do not.

The live PostgreSQL regression verifies:

- all eleven triggers exist;
- representative benchmark, context, framework-card, pack-membership,
  valuation-policy, and decision-policy updates/deletes fail;
- appending a distinct v2 framework pack still succeeds.

## Fix 2 — Pinned context selection

The Supabase repository now obtains the exact compiled Slice-1 profile from
`SLICE_ONE_CONTEXTS`, then queries and locally verifies both:

- the pinned context ID, such as
  `underwriting_context_seed_b2b_saas_v1`; and
- `context_version = 1`.

It no longer uses an unordered `limit=1` query. If the exact published pinned
row is absent, resolution fails closed rather than selecting a neighboring
version.

The regression presents Supabase results in v2-then-v1 order and confirms the
selected result is byte-for-byte equal to memory resolution of the same input.

## TDD evidence

Before implementation:

- the context parity test selected v2 and failed against memory v1;
- the live migration found only one immutable trigger instead of eleven.

After implementation:

- unit reference tests: 7 passed, 0 failed;
- live PostgreSQL migration tests: 2 passed, 0 failed.

## Final verification

```text
Focused Task 7 suite:
11 discovered
10 passed
0 failed
1 skipped only because the sandbox run cannot create PostgreSQL databases

Separate live PostgreSQL migration run:
2 passed
0 failed

TypeScript typecheck: passed
Lint: passed
git diff --check: passed
```
