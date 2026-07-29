# Task 7 Report — Underwriting Reference Spine

## Status

Implemented the smallest complete functional reference spine for Vertical
Slice 1:

- immutable, versioned Fund Policy snapshots with an active-version pointer;
- Balanced Recommended Policy v1 and one-click re-application with an
  explicit overwrite diff;
- append-only custom and restored policy versions;
- exactly four supported Stage × Business Model context profiles;
- US versus Global benchmark compatibility that never borrows an unavailable
  neighboring cohort;
- an eight-card, published, product-owned synthetic framework pack carrying
  zero formal decision weight;
- memory and Supabase/PostgREST repository adapters;
- Fund Policy read, edit, apply-recommended, list-version, and restore APIs;
- PostgreSQL schema, migration, seed data, RLS/grant boundary, and controlled
  activation RPC.

No real named investor/framework material, licensed body, private source object
key, or unverified current benchmark claim was seeded or made executable.

## Functional behavior

### Fund Policy

- A new workspace lazily receives Balanced Recommended Policy v1.
- Saving custom values appends a new immutable `user_custom` snapshot.
- Re-applying Balanced defaults appends a new `recommended_policy` snapshot
  and returns an alphabetically stable field-level overwrite diff.
- Restoring an older version copies it into a new immutable version; history is
  never rewound or overwritten.
- Expected-active-version checks fail closed on concurrent edits.
- Product owners/admins with `managePolicy` may mutate policy; `public_demo`
  may read but receives HTTP 403 for mutations.

### Context and framework references

- Supported profiles are:
  - Seed × B2B SaaS
  - Seed × Enterprise AI
  - Series A × B2B SaaS
  - Series A × Enterprise AI
- US B2B SaaS resolves the synthetic benchmark as `exact`.
- US Enterprise AI resolves it as `broad_compatible`.
- Global resolves pricing benchmark compatibility as `unavailable` with a
  null formal benchmark pack rather than borrowing the US cohort.
- Unsupported stage, model, geography, or security type fails closed.
- The public framework projection returns only published, synthetic,
  product-owned, zero-weight card fields. Draft cards and platform-private
  source fields are excluded.

## Persistence and security boundary

- `fund_policy_versions` is append-only and protected by an immutable trigger.
- `workspace_active_fund_policies` is the mutable pointer to the active
  immutable snapshot.
- Runtime writes use only
  `public.activate_fund_policy_version(jsonb)`.
- `service_role` first loses all privileges on every new reference/policy
  table, then receives only:
  - `SELECT` on the public reference projections and policy snapshots;
  - `EXECUTE` on the controlled Fund Policy activation RPC.
- `service_role` receives no access to `framework_sources`; the migration
  explicitly revokes all table privileges.
- `anon`, `authenticated`, and `public` receive no direct table or activation
  function access.
- Task 7 did not reopen or alter the existing companies/deals privilege
  boundary.

## Verification evidence

### TDD

The initial focused run failed because the repository, routes, and migration
did not exist. Implementation then proceeded through repository, API, and
migration green cycles. A later negative framework-projection test first
failed because a draft card was returned, then passed after the adapter added
published/synthetic filtering and a safe-field projection.

### Final focused verification

```text
Focused Task 7 tests:
10 tests discovered
9 passed
0 failed
1 skipped (sandbox PostgreSQL capability check)

Live PostgreSQL migration test outside the sandbox:
2 passed
0 failed

Lint:
passed

git diff --check:
passed
```

The live migration test applies migrations `0000` through `0010` in a fresh
temporary database, verifies four contexts and eight published synthetic
zero-weight cards, activates Balanced Policy v1 through the RPC, confirms
policy-version immutability, and confirms `service_role` cannot read
`framework_sources.private_body`.

Global TypeScript typecheck was clean after the Task 7 implementation, but the
final shared-worktree run was temporarily blocked by concurrent uncommitted
Task 10 valuation-test edits (`unit`, `evaluateDetailed`, and
`calculationScope` contract mismatches). Task 7 did not modify or stage those
files.

## Files delivered

- `drizzle/0010_underwriting_references.sql`
- `drizzle/meta/_journal.json`
- `db/schema.ts`
- `db/repositories/underwriting-references.ts`
- `lib/api/route-dependencies.ts`
- `lib/underwriting/references/service.ts`
- `seed/underwriting/balanced-policy-v1.ts`
- `seed/underwriting/slice-one-contexts-v1.ts`
- `seed/underwriting/framework-pack-v1.ts`
- `app/api/fund-policy/route.ts`
- `app/api/fund-policy/apply-recommended/route.ts`
- `app/api/fund-policy/versions/route.ts`
- `tests/unit/underwriting-references.test.ts`
- `tests/integration/fund-policy-route.test.ts`
- `tests/integration/underwriting-reference-migration.test.ts`

## Remaining concerns

- The benchmark and framework records are deliberately synthetic fixtures, not
  production investment guidance. Real sources require a separately reviewed,
  rights-safe publication workflow and verified benchmark revisions.
- The Supabase adapter requires migration `0010` and PostgREST schema reload in
  the deployed environment.
- A future platform-admin authoring surface must remain separate from ordinary
  workspace roles and must never expose `framework_sources` through the
  workspace API.
