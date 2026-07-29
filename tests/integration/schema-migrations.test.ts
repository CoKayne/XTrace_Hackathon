import assert from "node:assert/strict";
import { execFile, execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const freshSchemaPath = fileURLToPath(
  new URL("../../drizzle/0000_vsee_postgres.sql", import.meta.url),
);
const removeDeliveryPath = fileURLToPath(
  new URL("../../drizzle/0001_remove_report_delivery.sql", import.meta.url),
);
const durabilityMigrationPath = fileURLToPath(
  new URL("../../drizzle/0002_durable_decision_lineage.sql", import.meta.url),
);
const registryMigrationPath = fileURLToPath(
  new URL(
    "../../drizzle/0009_source_revision_deal_registry.sql",
    import.meta.url,
  ),
);
const postgresAvailable = spawnSync(
  "psql",
  [
    "-d",
    "postgres",
    "-Atqc",
    "select (rolsuper or rolcreatedb)::text from pg_roles where rolname = current_user",
  ],
  { encoding: "utf8" },
);
const canCreateTemporaryDatabase =
  postgresAvailable.status === 0
  && postgresAvailable.stdout.trim() === "true"
  && spawnSync("createdb", ["--version"]).status === 0
  && spawnSync("dropdb", ["--version"]).status === 0;
const requirePostgres = process.env.REQUIRE_POSTGRES_MIGRATION_TESTS === "1";

function withTemporaryDatabase(run: (database: string) => void): void {
  const database = `vsee_migration_${process.pid}_${randomUUID().replaceAll("-", "")}`;
  execFileSync("createdb", [database], { stdio: "pipe" });
  try {
    run(database);
  } finally {
    execFileSync("dropdb", ["--if-exists", database], { stdio: "pipe" });
  }
}

async function withTemporaryDatabaseAsync(
  run: (database: string) => Promise<void>,
): Promise<void> {
  const database = `vsee_migration_${process.pid}_${
    randomUUID().replaceAll("-", "")
  }`;
  execFileSync("createdb", [database], { stdio: "pipe" });
  try {
    await run(database);
  } finally {
    execFileSync("dropdb", ["--if-exists", database], { stdio: "pipe" });
  }
}

function applySql(database: string, path: string): void {
  execFileSync(
    "psql",
    ["-v", "ON_ERROR_STOP=1", "-d", database, "-f", path],
    { stdio: "pipe" },
  );
}

function executeSql(database: string, sql: string): string {
  return execFileSync(
    "psql",
    ["-v", "ON_ERROR_STOP=1", "-d", database, "-AtF", "|", "-c", sql],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
}

async function executeSqlAsync(database: string, sql: string): Promise<string> {
  const result = await execFileAsync(
    "psql",
    ["-v", "ON_ERROR_STOP=1", "-d", database, "-AtF", "|", "-c", sql],
    { encoding: "utf8" },
  );
  return result.stdout.trim();
}

test(
  "fresh PostgreSQL schema requires durable decision and XTrace reuse metadata",
  { skip: !canCreateTemporaryDatabase && !requirePostgres },
  () => {
    assert.equal(
      canCreateTemporaryDatabase,
      true,
      "PostgreSQL with temporary-database privileges is required.",
    );
    assert.ok(existsSync(durabilityMigrationPath), "forward durability migration must exist");
    withTemporaryDatabase((database) => {
      applySql(database, freshSchemaPath);
      applySql(database, removeDeliveryPath);
      applySql(database, durabilityMigrationPath);

      const columns = executeSql(database, `
        select table_name || '.' || column_name || ':' || is_nullable
        from information_schema.columns
        where table_schema = 'public'
          and (
            (table_name = 'deal_interactions' and column_name = 'decision_reason')
            or (
              table_name = 'xtrace_ingest_jobs'
              and column_name in ('bundle_fingerprint', 'serializer_version')
            )
          )
        order by table_name, column_name;
      `);

      assert.equal(columns, [
        "deal_interactions.decision_reason:NO",
        "xtrace_ingest_jobs.bundle_fingerprint:NO",
        "xtrace_ingest_jobs.serializer_version:NO",
      ].join("\n"));
    });
  },
);

test(
  "0009 installs immutable workspace-scoped source revisions and atomic Deal assignment",
  { skip: !canCreateTemporaryDatabase && !requirePostgres },
  () => {
    assert.equal(
      canCreateTemporaryDatabase,
      true,
      "PostgreSQL with temporary-database privileges is required.",
    );
    assert.ok(
      existsSync(registryMigrationPath),
      "source revision registry migration must exist",
    );
    withTemporaryDatabase((database) => {
      const migrations = [
        "0000_vsee_postgres.sql",
        "0001_remove_report_delivery.sql",
        "0002_durable_decision_lineage.sql",
        "0003_sanitize_report_next_steps.sql",
        "0004_company_analyses.sql",
        "0005_sample_decision_label.sql",
        "0006_reasoner_judgments.sql",
        "0007_uploaded_documents.sql",
        "0008_workspace_composite_identity.sql",
        "0009_source_revision_deal_registry.sql",
      ];
      for (const migration of migrations) {
        applySql(
          database,
          fileURLToPath(new URL(`../../drizzle/${migration}`, import.meta.url)),
        );
      }

      assert.equal(
        executeSql(database, `
          select table_name
          from information_schema.tables
          where table_schema = 'public'
            and table_name in (
              'source_revisions',
              'source_revision_annotations',
              'deal_source_assignments'
            )
          order by table_name;
        `),
        [
          "deal_source_assignments",
          "source_revision_annotations",
          "source_revisions",
        ].join("\n"),
      );
      assert.equal(
        executeSql(database, `
          select column_name || ':' || is_nullable
          from information_schema.columns
          where table_schema = 'public'
            and table_name = 'deals'
            and column_name in (
              'analysis_eligible_at',
              'active_source_revision_fingerprint',
              'status'
            )
          order by column_name;
        `),
        [
          "active_source_revision_fingerprint:YES",
          "analysis_eligible_at:YES",
          "status:NO",
        ].join("\n"),
      );
      assert.equal(
        executeSql(database, `
          select routine_name
          from information_schema.routines
          where routine_schema = 'public'
            and routine_name in (
              'append_source_revision',
              'confirm_source_assignment',
              'create_initial_source_revision'
            )
          order by routine_name;
        `),
        [
          "append_source_revision",
          "confirm_source_assignment",
          "create_initial_source_revision",
        ].join("\n"),
      );

      executeSql(database, `
        insert into public.workspaces (id, name)
        values ('workspace_one', 'One'), ('workspace_two', 'Two');
        select id
        from public.create_initial_source_revision(jsonb_build_object(
          'id', 'revision_shared',
          'workspaceId', 'workspace_one',
          'sourceId', 'source_one',
          'contentHash', 'hash_one',
          'objectKey', 'private/workspace_one/source_one.pdf',
          'objectVersion', 'hash_one',
          'contentType', 'application/pdf',
          'extractorId', 'pdf-text',
          'extractorVersion', '1',
          'extractedAt', '2026-07-28T10:00:00.000Z',
          'createdAt', '2026-07-28T10:00:01.000Z'
        ));
        select id
        from public.create_initial_source_revision(jsonb_build_object(
          'id', 'revision_shared',
          'workspaceId', 'workspace_one',
          'sourceId', 'source_one',
          'contentHash', 'hash_one',
          'objectKey', 'private/workspace_one/source_one.pdf',
          'objectVersion', 'hash_one',
          'contentType', 'application/pdf',
          'extractorId', 'pdf-text',
          'extractorVersion', '1',
          'extractedAt', '2026-07-28T10:00:00.000Z',
          'createdAt', '2026-07-28T10:00:01.000Z'
        ));
        select id
        from public.append_source_revision(jsonb_build_object(
          'id', 'revision_two',
          'workspaceId', 'workspace_one',
          'sourceId', 'source_one',
          'contentHash', 'hash_two',
          'objectKey', 'private/workspace_one/source_one-v2.pdf',
          'objectVersion', 'hash_two',
          'contentType', 'application/pdf',
          'extractorId', 'pdf-text',
          'extractorVersion', '1',
          'extractedAt', '2026-07-28T11:00:00.000Z',
          'createdAt', '2026-07-28T11:00:01.000Z',
          'supersedesRevisionId', 'revision_shared'
        ));
        select id
        from public.create_initial_source_revision(jsonb_build_object(
          'id', 'revision_shared',
          'workspaceId', 'workspace_two',
          'sourceId', 'source_one',
          'contentHash', 'hash_workspace_two',
          'objectKey', 'private/workspace_two/source_one.pdf',
          'objectVersion', 'hash_workspace_two',
          'contentType', 'application/pdf',
          'extractorId', 'pdf-text',
          'extractorVersion', '1',
          'extractedAt', '2026-07-28T10:00:00.000Z',
          'createdAt', '2026-07-28T10:00:01.000Z'
        ));
      `);
      assert.equal(
        executeSql(database, `
          select workspace_id || '|' || id || '|' || revision
          from public.source_revisions
          order by workspace_id, revision;
        `),
        [
          "workspace_one|revision_shared|1",
          "workspace_one|revision_two|2",
          "workspace_two|revision_shared|1",
        ].join("\n"),
      );
      assert.throws(() =>
        executeSql(database, `
          update public.source_revisions
          set content_hash = 'mutated'
          where workspace_id = 'workspace_one'
            and id = 'revision_shared';
        `)
      );
      assert.throws(() =>
        executeSql(database, `
          select id
          from public.append_source_revision(jsonb_build_object(
            'id', 'revision_stale',
            'workspaceId', 'workspace_one',
            'sourceId', 'source_one',
            'contentHash', 'hash_stale',
            'objectKey', 'private/stale.pdf',
            'objectVersion', 'hash_stale',
            'contentType', 'application/pdf',
            'extractorId', 'pdf-text',
            'extractorVersion', '1',
            'extractedAt', '2026-07-28T12:00:00.000Z',
            'createdAt', '2026-07-28T12:00:01.000Z',
            'supersedesRevisionId', 'revision_shared'
          ));
        `)
      );
      assert.throws(() =>
        executeSql(database, `
          insert into public.source_revisions (
            id, workspace_id, source_id, revision, content_hash, object_key,
            object_version, content_type, extractor_id, extractor_version,
            extracted_at, supersedes_revision_id, created_at
          ) values (
            'revision_four_invalid', 'workspace_one', 'source_one', 4,
            'hash_four', 'private/four.pdf', 'hash_four',
            'application/pdf', 'pdf-text', '1', now(), 'revision_two', now()
          );
        `)
      );

      executeSql(database, `
        select public.confirm_source_assignment(jsonb_build_object(
          'requestId', 'request_one',
          'workspaceId', 'workspace_one',
          'dealId', 'deal_one',
          'companyId', 'company_one',
          'companyName', 'Company one',
          'status', 'screening',
          'sourceRevisionId', 'revision_two',
          'assignedByUserId', 'user_one',
          'reason', 'Confirmed source ownership.',
          'confirmedAt', '2026-07-28T12:00:00.000Z'
        ));
        select public.confirm_source_assignment(jsonb_build_object(
          'requestId', 'request_one',
          'workspaceId', 'workspace_one',
          'dealId', 'deal_one',
          'companyId', 'company_one',
          'companyName', 'Company one',
          'status', 'screening',
          'sourceRevisionId', 'revision_two',
          'assignedByUserId', 'user_one',
          'reason', 'Confirmed source ownership.',
          'confirmedAt', '2026-07-28T12:00:00.000Z'
        ));
      `);
      assert.equal(
        executeSql(database, `
          select count(*) || '|' || to_char(
            max(deal.analysis_eligible_at) at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS"Z"'
          )
            || '|' || max(deal.active_source_revision_fingerprint)
          from public.deal_source_assignments as assignment
          join public.deals as deal
            on deal.workspace_id = assignment.workspace_id
            and deal.id = assignment.deal_id
          where assignment.workspace_id = 'workspace_one'
            and assignment.deal_id = 'deal_one';
        `),
        "1|2026-07-28T12:00:00Z|source-revisions-v1:revision_two",
      );
    });
  },
);

test(
  "0009 backfills a legacy 0000-through-0008 source-backed Deal without fixed cardinality",
  { skip: !canCreateTemporaryDatabase && !requirePostgres },
  () => {
    assert.equal(
      canCreateTemporaryDatabase,
      true,
      "PostgreSQL with temporary-database privileges is required.",
    );
    withTemporaryDatabase((database) => {
      const migrations = [
        "0000_vsee_postgres.sql",
        "0001_remove_report_delivery.sql",
        "0002_durable_decision_lineage.sql",
        "0003_sanitize_report_next_steps.sql",
        "0004_company_analyses.sql",
        "0005_sample_decision_label.sql",
        "0006_reasoner_judgments.sql",
        "0007_uploaded_documents.sql",
        "0008_workspace_composite_identity.sql",
      ];
      for (const migration of migrations) {
        applySql(
          database,
          fileURLToPath(new URL(`../../drizzle/${migration}`, import.meta.url)),
        );
      }
      executeSql(database, `
        insert into public.workspaces (id, name)
        values ('workspace_legacy', 'Legacy');
        insert into public.source_documents (
          id, filename, title, role, checksum, byte_size, object_key
        ) values (
          'doc_legacy', 'legacy.pdf', 'Legacy source', 'deal_document',
          'hash_legacy', 10, 'private/demo-corpus/hash/legacy.pdf'
        );
        insert into public.companies (workspace_id, id, name)
        values ('workspace_legacy', 'company_legacy', 'Legacy company');
        insert into public.deals (
          workspace_id, id, company_id, company_name
        ) values (
          'workspace_legacy', 'deal_legacy', 'company_legacy',
          'Legacy company'
        );
        insert into public.source_evidence (
          workspace_id, id, document_id, deal_id, company_name,
          provenance, page, fact, excerpt
        ) values (
          'workspace_legacy', 'evidence_legacy', 'doc_legacy',
          'deal_legacy', 'Legacy company', 'source_document', 1,
          'A legacy fact.', 'A legacy excerpt.'
        );
      `);

      applySql(database, registryMigrationPath);

      assert.equal(
        executeSql(database, `
          select revision.revision || '|' || assignment.deal_id || '|'
            || deal.status || '|'
            || (deal.analysis_eligible_at is not null)::text || '|'
            || deal.active_source_revision_fingerprint
          from public.source_revisions as revision
          join public.deal_source_assignments as assignment
            on assignment.workspace_id = revision.workspace_id
            and assignment.source_revision_id = revision.id
          join public.deals as deal
            on deal.workspace_id = assignment.workspace_id
            and deal.id = assignment.deal_id
          where revision.workspace_id = 'workspace_legacy';
        `),
        "1|deal_legacy|screening|true|source-revisions-v1:source_revision_doc_legacy_1",
      );
    });
  },
);

test(
  "0009 serializes concurrent appends so only one revision two can commit",
  { skip: !canCreateTemporaryDatabase && !requirePostgres },
  async () => {
    assert.equal(
      canCreateTemporaryDatabase,
      true,
      "PostgreSQL with temporary-database privileges is required.",
    );
    await withTemporaryDatabaseAsync(async (database) => {
      const migrations = [
        "0000_vsee_postgres.sql",
        "0001_remove_report_delivery.sql",
        "0002_durable_decision_lineage.sql",
        "0003_sanitize_report_next_steps.sql",
        "0004_company_analyses.sql",
        "0005_sample_decision_label.sql",
        "0006_reasoner_judgments.sql",
        "0007_uploaded_documents.sql",
        "0008_workspace_composite_identity.sql",
        "0009_source_revision_deal_registry.sql",
      ];
      for (const migration of migrations) {
        applySql(
          database,
          fileURLToPath(new URL(`../../drizzle/${migration}`, import.meta.url)),
        );
      }
      executeSql(database, `
        insert into public.workspaces (id, name)
        values ('workspace_concurrent', 'Concurrent');
        select id
        from public.create_initial_source_revision(jsonb_build_object(
          'id', 'revision_one',
          'workspaceId', 'workspace_concurrent',
          'sourceId', 'source_concurrent',
          'contentHash', 'hash_one',
          'objectKey', 'private/source-one.pdf',
          'objectVersion', 'hash_one',
          'contentType', 'application/pdf',
          'extractorId', 'pdf-text',
          'extractorVersion', '1',
          'extractedAt', '2026-07-28T10:00:00.000Z',
          'createdAt', '2026-07-28T10:00:01.000Z'
        ));
      `);
      const appendSql = (suffix: string) => `
        select id
        from public.append_source_revision(jsonb_build_object(
          'id', 'revision_two_${suffix}',
          'workspaceId', 'workspace_concurrent',
          'sourceId', 'source_concurrent',
          'contentHash', 'hash_${suffix}',
          'objectKey', 'private/source-${suffix}.pdf',
          'objectVersion', 'hash_${suffix}',
          'contentType', 'application/pdf',
          'extractorId', 'pdf-text',
          'extractorVersion', '1',
          'extractedAt', '2026-07-28T11:00:00.000Z',
          'createdAt', '2026-07-28T11:00:01.000Z',
          'supersedesRevisionId', 'revision_one'
        ));
      `;
      const outcomes = await Promise.allSettled([
        executeSqlAsync(database, appendSql("a")),
        executeSqlAsync(database, appendSql("b")),
      ]);
      assert.equal(
        outcomes.filter((outcome) => outcome.status === "fulfilled").length,
        1,
      );
      assert.equal(
        outcomes.filter((outcome) => outcome.status === "rejected").length,
        1,
      );
      assert.equal(
        executeSql(database, `
          select count(*) || '|' || max(revision)
          from public.source_revisions
          where workspace_id = 'workspace_concurrent';
        `),
        "2|2",
      );
    });
  },
);

test(
  "forward migration backfills legacy rows without treating synthetic rationale as a source fact",
  { skip: !canCreateTemporaryDatabase && !requirePostgres },
  () => {
    assert.equal(
      canCreateTemporaryDatabase,
      true,
      "PostgreSQL with temporary-database privileges is required.",
    );
    assert.ok(existsSync(durabilityMigrationPath), "forward durability migration must exist");
    withTemporaryDatabase((database) => {
      executeSql(database, `
        create table deal_interactions (
          id text primary key
        );
        insert into deal_interactions (id) values ('fixture_legacy');
        create table xtrace_ingest_jobs (
          job_id text primary key
        );
        insert into xtrace_ingest_jobs (job_id) values ('job_legacy');
        create table xtrace_memory_links (
          memory_id text primary key,
          deal_id text not null
        );
        insert into xtrace_memory_links (memory_id, deal_id)
        values ('mem_legacy', 'deal_legacy');
      `);

      applySql(database, durabilityMigrationPath);
      applySql(database, durabilityMigrationPath);

      assert.equal(
        executeSql(database, `
          select decision_reason
          from deal_interactions
          where id = 'fixture_legacy';
        `),
        "Synthetic fallback: the original demo decision rationale was not persisted before this migration.",
      );
      assert.equal(
        executeSql(database, `
          select bundle_fingerprint || '|' || serializer_version
          from xtrace_ingest_jobs
          where job_id = 'job_legacy';
        `),
        "legacy-unfingerprinted|legacy-v0",
      );
      assert.equal(
        executeSql(database, `
          select memory_id || '|' || deal_id
          from xtrace_memory_links
          where memory_id = 'mem_legacy';
        `),
        "mem_legacy|deal_legacy",
      );
      assert.equal(
        executeSql(database, `
          select count(*)
          from information_schema.columns
          where table_schema = 'public'
            and is_nullable = 'NO'
            and (
              (table_name = 'deal_interactions' and column_name = 'decision_reason')
              or (
                table_name = 'xtrace_ingest_jobs'
                and column_name in ('bundle_fingerprint', 'serializer_version')
              )
            );
        `),
        "3",
      );
    });
  },
);
