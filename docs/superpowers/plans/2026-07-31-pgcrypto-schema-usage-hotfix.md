# Pgcrypto Schema Usage Production Hotfix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the production canonical Deal snapshot RPC by granting the private registry owner the minimum schema privilege required to invoke Supabase-hosted `pgcrypto.digest`.

**Architecture:** Add a forward-only `0018` migration that discovers the schema containing the extension-owned `digest(bytea,text)` function and grants only `USAGE` on that schema to `vsee_registry_owner`. Keep the public API boundary unchanged: `service_role` may execute `get_analysis_eligible_snapshot(text)`, while helper functions remain private. Extend the guarded production launcher and PostgreSQL integration gates through `0018`, then apply the exact reviewed migration and rerun the production E2E.

**Tech Stack:** PostgreSQL 17 / Supabase, PostgREST, TypeScript Node test runner, zsh release launchers.

## Global Constraints

- The production failure is `42501: permission denied for schema extensions` from `public.get_analysis_eligible_snapshot(text)`.
- Grant only schema `USAGE` to `vsee_registry_owner`; do not grant it to `anon`, `authenticated`, or `service_role`.
- Preserve the existing `service_role → get_analysis_eligible_snapshot(text)` RPC boundary and do not expose helper functions.
- Use a forward-only migration; do not edit the already-applied meaning of `0009`.
- The migration must discover the actual pgcrypto digest schema instead of hard-coding `extensions`.
- The migration must fail closed if the required extension-owned `digest(bytea,text)` function cannot be identified exactly once.
- Production catalog checks, registry invariants, worker commit identity, and public-sandbox behavior must remain enforced.
- Do not print credentials, connection strings, API keys, or authorization headers.

---

### Task 1: Add the Regression Gate and Minimal Forward Migration

**Files:**
- Create: `drizzle/0018_pgcrypto_registry_schema_usage.sql`
- Create: `tests/integration/pgcrypto-registry-schema-usage-migration.test.ts`
- Modify: `drizzle/meta/_journal.json`
- Modify: `package.json`

**Interfaces:**
- Consumes: `public.get_analysis_eligible_snapshot(text)` and role `vsee_registry_owner` created by migration `0009`.
- Produces: migration sentinel behavior `has_schema_privilege('vsee_registry_owner', <pgcrypto schema>, 'USAGE') = true`.

- [ ] **Step 1: Write the failing integration test**

Create a temporary database, create `pgcrypto` in schema `extensions`, apply migrations `0000` through `0017`, and prove that the final migration makes this real role-bound call return `0`:

```sql
set role service_role;
select public.get_analysis_eligible_snapshot('workspace_empty')->>'count';
reset role;
```

The test must also assert:

```sql
select
  has_schema_privilege('vsee_registry_owner', 'extensions', 'USAGE')
  and not has_schema_privilege('anon', 'extensions', 'USAGE')
  and not has_schema_privilege('authenticated', 'extensions', 'USAGE')
  and not has_schema_privilege('service_role', 'extensions', 'USAGE');
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
REQUIRE_POSTGRES_MIGRATION_TESTS=1 node --import tsx --test --test-concurrency=1 tests/integration/pgcrypto-registry-schema-usage-migration.test.ts
```

Expected: FAIL because `0018_pgcrypto_registry_schema_usage.sql` does not yet exist.

- [ ] **Step 3: Add the minimal migration**

The migration must:

```sql
begin;

do $migration$
declare
  digest_schema text;
begin
  select namespace.nspname
  into strict digest_schema
  from pg_catalog.pg_extension as extension_record
  join pg_catalog.pg_depend as dependency
    on dependency.refclassid = 'pg_catalog.pg_extension'::regclass
    and dependency.refobjid = extension_record.oid
    and dependency.classid = 'pg_catalog.pg_proc'::regclass
    and dependency.deptype = 'e'
  join pg_catalog.pg_proc as procedure_record
    on procedure_record.oid = dependency.objid
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = procedure_record.pronamespace
  where extension_record.extname = 'pgcrypto'
    and procedure_record.proname = 'digest'
    and procedure_record.proargtypes = '17 25'::oidvector;

  execute pg_catalog.format(
    'grant usage on schema %I to vsee_registry_owner',
    digest_schema
  );
end;
$migration$;

commit;
```

Add the exact `0018_pgcrypto_registry_schema_usage` journal entry and include the focused test in `npm run test:migrations`.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the same focused command. Expected: PASS, including the service-role snapshot call and negative grants for public API roles.

- [ ] **Step 5: Commit Task 1**

Commit only the migration, focused integration test, journal, and package-script change.

---

### Task 2: Extend the Guarded Release Chain Through 0018

**Files:**
- Modify: `scripts/apply-production-migrations.zsh`
- Modify: `scripts/bootstrap-production-baseline.zsh`
- Modify: `scripts/production-catalog-fingerprints.zsh`
- Modify: `tests/integration/production-baseline-bridge.test.ts`
- Modify: `tests/integration/schema-migrations.test.ts`
- Modify: `tests/unit/release-readiness.test.ts`
- Modify: `tests/unit/production-baseline-bootstrap.test.ts`
- Modify: `tests/integration/workspace-composite-migration.test.ts`
- Modify: `README.md`
- Modify: `docs/demo-runbook.md`

**Interfaces:**
- Consumes: Task 1 migration and sentinel query.
- Produces: both guarded launchers recognize a contiguous reviewed chain through `0018`; the `0018` catalog fingerprint is intentionally identical to `0017` because the catalog manifest does not track ACLs for the external pgcrypto schema or the private owner role.

- [ ] **Step 1: Write failing release-readiness expectations**

Update the release tests to require:

```text
0018_pgcrypto_registry_schema_usage.sql
```

and require both guarded launcher E2Es to report and verify `0018`.

- [ ] **Step 2: Run release tests and verify RED**

Run:

```bash
node --import tsx --test --test-concurrency=1 tests/unit/release-readiness.test.ts tests/unit/production-baseline-bootstrap.test.ts tests/integration/workspace-composite-migration.test.ts
```

Expected: FAIL because launchers and catalog stage mapping stop at `0017`.

- [ ] **Step 3: Extend launchers and reviewed catalog mapping**

Add the `0018` sentinel by dynamically locating the pgcrypto digest schema and checking `vsee_registry_owner` schema `USAGE`. Append `0018` to both migration sequences. Map stage `0018` to the same accepted fingerprint set as `0017`; do not invent a new catalog hash.

- [ ] **Step 4: Update operator documentation**

Change the physical migration chain, launcher completion wording, rollback note, and production verification instructions from `0017` to `0018`. State that `0018` repairs only the internal pgcrypto schema dependency used by canonical fingerprints.

- [ ] **Step 5: Run migration and release gates**

Run:

```bash
npm run test:migrations
npm run test:migrations:production-pg176
node --import tsx --test --test-concurrency=1 tests/unit/release-readiness.test.ts tests/unit/production-baseline-bootstrap.test.ts tests/integration/workspace-composite-migration.test.ts
```

Expected: all PASS.

- [ ] **Step 6: Commit Task 2**

Commit the launcher, catalog mapping, tests, and operator documentation.

---

### Task 3: Apply, Deploy, and Verify the Production E2E

**Files:**
- No source files unless a newly reproduced defect requires a separate tested fix.

**Interfaces:**
- Consumes: exact reviewed Git commit containing Tasks 1 and 2.
- Produces: production database at migration `0018`, Sites deployment and Worker on the same commit, and a completed XTrace scan with visible downstream artifacts.

- [ ] **Step 1: Run full local release verification**

Run:

```bash
npm ci
npm test
npm run typecheck
npm run lint
npm run build
npm run verify:web-parser-boundary
npm run test:legacy
```

Expected: zero failures; only previously documented lint warnings and external-service skips may remain.

- [ ] **Step 2: Review the complete hotfix diff**

Require independent spec-compliance and code-quality approval before touching production.

- [ ] **Step 3: Push the exact reviewed commit and apply migration `0018`**

Use the guarded production launcher. Expected final message:

```text
All production migrations through 0018 match their reviewed catalog and data invariants.
```

- [ ] **Step 4: Restart Worker and deploy Sites from the same commit**

Health must show PostgreSQL, Worker, XTrace, Anthropic, storage, and fixed corpus ready.

- [ ] **Step 5: Run the complete production smoke**

Run one XTrace-enabled scan and verify every terminal stage:

```text
import_confirmation
market_scan
memory_ingest_sync
memory_recall
opportunity_matching
report
underwriting
notification
```

Then verify Market, report details, per-company underwriting, named framework source metadata with zero formal decision weight, five action drafts for a finalized candidate, Chat, Search, upload controls, Fund Policy, and Reset.

- [ ] **Step 6: Visually inspect the production UI**

Confirm the report format and all primary navigation areas render without an internal server error.

- [ ] **Step 7: Retain rollback evidence and deliver**

Keep the pre-migration database dump until the full smoke passes. Report the live URL, exact deployed commit, verification evidence, and documented non-blocking dependency debt.
