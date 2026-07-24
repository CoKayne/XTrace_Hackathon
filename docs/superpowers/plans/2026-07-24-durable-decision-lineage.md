# Durable Decision and XTrace Lineage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist synthetic VC decision rationales durably and make XTrace ingest reuse depend on the exact serialized bundle plus an explicit serializer version.

**Architecture:** PostgreSQL remains the durable source for imported synthetic decision records and XTrace job lineage. The XTrace service hashes the exact deterministic text sent to XTrace with SHA-256, stores that fingerprint and the serializer version on each ingest job, and only reuses jobs when workspace, Deal, source IDs, fixture IDs, fingerprint, and version all match. Existing lineage rows receive explicit legacy sentinels so their memory links remain resolvable but cannot be mistaken for current-format ingests.

**Tech Stack:** TypeScript 5.9, Node.js 22 crypto, PostgreSQL/Supabase REST, Drizzle ORM, Node test runner.

## Global Constraints

- Follow strict red-green-refactor TDD and record the expected RED cause.
- Preserve all unrelated concurrent work and commit only files owned by this fix.
- `decision_reason` is synthetic demo rationale and must never be represented as a source-backed fact.
- Fingerprints must be deterministic SHA-256 hashes of serialized bundle content only; never hash credentials or runtime timestamps outside that content.
- Do not delete prior XTrace memories or lineage.

---

### Task 1: Persist decision rationale in fresh and upgraded databases

**Files:**
- Modify: `tests/unit/storage-service.test.ts`
- Create: `tests/integration/schema-migrations.test.ts`
- Modify: `lib/storage/service.ts`
- Modify: `db/schema.ts`
- Modify: `drizzle/0000_vsee_postgres.sql`
- Create: `drizzle/0002_durable_decision_lineage.sql`

**Interfaces:**
- Consumes: `StoredFixtureRecord.decisionReason: string`.
- Produces: `deal_interactions.decision_reason text not null` and a Supabase upsert field named `decision_reason`.

- [x] **Step 1: Write failing storage and migration tests**

Add a storage boundary test that captures the `deal_interactions` POST body and expects the exact `decision_reason`. Add PostgreSQL-backed tests that apply the fresh migration chain and upgrade a legacy row, asserting a non-null explicit synthetic fallback.

- [x] **Step 2: Run the focused tests and verify RED**

Run: `node --import tsx --test tests/unit/storage-service.test.ts tests/integration/schema-migrations.test.ts`

Expected: FAIL because the upsert omits `decision_reason`, fresh SQL lacks the column, and `0002` does not exist.

- [x] **Step 3: Add the schema, mapping, and forward migration**

Model `dealInteractions` in Drizzle, add `decision_reason text not null` to fresh SQL, write it in `ensureFixture`, and make `0002` add/backfill/enforce the column. The fallback must explicitly identify itself as synthetic historical migration data.

- [x] **Step 4: Re-run focused tests and verify GREEN**

Run: `node --import tsx --test tests/unit/storage-service.test.ts tests/integration/schema-migrations.test.ts`

Expected: PASS.

### Task 2: Make XTrace ingest reuse content- and version-aware

**Files:**
- Modify: `tests/unit/xtrace-service.test.ts`
- Modify: `db/repositories/xtrace-lineage.ts`
- Modify: `lib/xtrace/service.ts`
- Modify: `db/schema.ts`
- Modify: `drizzle/0000_vsee_postgres.sql`
- Modify: `drizzle/0002_durable_decision_lineage.sql`

**Interfaces:**
- Produces: `XTraceIngestLineage.bundleFingerprint: string`.
- Produces: `XTraceIngestLineage.serializerVersion: string`.
- Produces: `DEAL_MEMORY_SERIALIZER_VERSION`.
- Extends: `findReusableIngest(...)` to require both fields.

- [x] **Step 1: Write failing reuse and repository boundary tests**

Keep the existing unchanged-bundle reuse assertion. Add assertions that changing only `decisionReason` causes a second ingest, changing only the injected serializer version causes a second ingest, Supabase submissions store both fields, and Supabase reuse queries/matches both fields.

- [x] **Step 2: Run the focused tests and verify RED**

Run: `node --import tsx --test tests/unit/xtrace-service.test.ts`

Expected: FAIL because changed content and versions currently reuse the old job and lineage persistence has no fingerprint/version fields.

- [x] **Step 3: Implement deterministic hashing and durable lineage**

Hash the exact result of `serializeBundle` using Node SHA-256, pass the same serialized string to XTrace, persist the hash and serializer version in memory/Supabase repositories, and require both for reuse. Add non-null fresh-schema columns and legacy sentinels in `0002`; do not alter `xtrace_memory_links`.

- [x] **Step 4: Re-run focused tests and verify GREEN**

Run: `node --import tsx --test tests/unit/xtrace-service.test.ts`

Expected: PASS.

### Task 3: Verify migration sequence and regressions

**Files:**
- Modify: `README.md`

- [x] **Step 1: Document the third migration**

List `0002_durable_decision_lineage.sql` after `0001_remove_report_delivery.sql` for existing deployments.

- [x] **Step 2: Run complete verification**

Run:

```bash
npm test
npm run typecheck
npm run lint
npm run build
git diff --check
```

Expected: all commands pass, with only intentionally skipped external live tests.

- [x] **Step 3: Commit only scoped files**

Commit the plan, tests, SQL, storage/schema mappings, XTrace repository/service, and README without staging unrelated concurrent changes.
