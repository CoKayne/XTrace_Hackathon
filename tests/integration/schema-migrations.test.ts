import assert from "node:assert/strict";
import { execFile, execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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
      executeSql(database, `
        do $$
        begin
          create role service_role nologin noinherit nobypassrls;
        exception when duplicate_object then null;
        end;
        $$;
      `);
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
      const mirroredConstraints = [
        "deals_status_check",
        "source_revisions_revision_check",
        "source_revisions_content_hash_check",
        "source_revisions_object_key_check",
        "source_revisions_object_version_check",
        "source_revisions_content_type_check",
        "source_revisions_extractor_id_check",
        "source_revisions_extractor_version_check",
        "source_revisions_initial_link_check",
        "source_revision_annotations_kind_check",
        "source_revision_annotations_reason_check",
        "deal_source_assignments_request_id_check",
        "deal_source_assignments_request_fingerprint_check",
        "deal_source_assignments_assigned_by_user_id_check",
        "deal_source_assignments_reason_check",
        "deal_source_assignments_supersession_time_check",
        "intelligence_reports_eligible_snapshot_check",
      ];
      const schemaSource = readFileSync(
        fileURLToPath(new URL("../../db/schema.ts", import.meta.url)),
        "utf8",
      );
      for (const constraint of mirroredConstraints) {
        assert.match(schemaSource, new RegExp(constraint));
      }
      assert.equal(
        executeSql(database, `
          select count(*)
          from pg_constraint
          where connamespace = 'public'::regnamespace
            and conname = any(array[
              ${mirroredConstraints.map((name) => `'${name}'`).join(",")}
            ]);
        `),
        String(mirroredConstraints.length),
      );
      assert.match(
        executeSql(database, `
          select pg_get_indexdef(indexrelid)
          from pg_index
          where indexrelid =
            'public.deal_source_assignments_one_active_source'::regclass;
        `),
        /workspace_id.*deal_id.*source_id.*superseded_at IS NULL/i,
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
        "1|2026-07-28T12:00:00Z|sha256:e261978d1aa749a6b4efa250d1e6ce21d151c1dc124dcfda394aa0d7ef936743",
      );
      executeSql(database, `
        select id from public.append_source_revision(jsonb_build_object(
          'id', 'revision_three',
          'workspaceId', 'workspace_one',
          'sourceId', 'source_one',
          'contentHash', 'hash_three',
          'objectKey', 'private/workspace_one/source-one-v3.pdf',
          'objectVersion', 'hash_three',
          'contentType', 'application/pdf',
          'extractorId', 'pdf-text',
          'extractorVersion', '1',
          'extractedAt', '2026-07-28T13:00:00.000Z',
          'createdAt', '2026-07-28T13:00:01.000Z',
          'supersedesRevisionId', 'revision_two'
        ));
      `);
      assert.equal(
        executeSql(database, `
          select revision from public.append_source_revision(
            jsonb_build_object(
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
            )
          );
        `),
        "2",
      );
      assert.throws(() =>
        executeSql(database, `
          select revision from public.append_source_revision(
            jsonb_build_object(
              'id', 'revision_two',
              'workspaceId', 'workspace_one',
              'sourceId', 'source_one',
              'contentHash', 'different',
              'objectKey', 'private/workspace_one/source_one-v2.pdf',
              'objectVersion', 'hash_two',
              'contentType', 'application/pdf',
              'extractorId', 'pdf-text',
              'extractorVersion', '1',
              'extractedAt', '2026-07-28T11:00:00.000Z',
              'createdAt', '2026-07-28T11:00:01.000Z',
              'supersedesRevisionId', 'revision_shared'
            )
          );
        `)
      );

      assert.equal(
        executeSql(database, `
          select p.proname || '|' || r.rolname || '|'
            || array_to_string(p.proconfig, ',')
          from pg_proc as p
          join pg_namespace as n on n.oid = p.pronamespace
          join pg_roles as r on r.oid = p.proowner
          where n.nspname = 'public'
            and p.proname in (
              'annotate_source_revision',
              'append_source_revision',
              'confirm_source_assignment',
              'create_initial_source_revision'
            )
          order by p.proname;
        `),
        [
          "annotate_source_revision|vsee_registry_owner|search_path=\"\"",
          "append_source_revision|vsee_registry_owner|search_path=\"\"",
          "confirm_source_assignment|vsee_registry_owner|search_path=\"\"",
          "create_initial_source_revision|vsee_registry_owner|search_path=\"\"",
        ].join("\n"),
      );
      executeSql(database, `
        set role service_role;
        select public.annotate_source_revision(jsonb_build_object(
          'workspaceId', 'workspace_one',
          'revisionId', 'revision_two',
          'kind', 'retracted',
          'reason', 'Verified RPC boundary.'
        ));
        select count(*) from public.source_revisions;
        reset role;
      `);
      for (const forbidden of [
        "insert into public.source_revisions (id) values ('bypass')",
        "insert into public.source_revision_annotations (workspace_id, revision_id, kind, reason) values ('workspace_one', 'revision_two', 'retracted', 'bypass')",
        "insert into public.deal_source_assignments (id) values ('bypass')",
        "update public.deals set analysis_eligible_at = now() where workspace_id = 'workspace_one' and id = 'deal_one'",
        "update public.deals set active_source_revision_fingerprint = 'bypass' where workspace_id = 'workspace_one' and id = 'deal_one'",
        "truncate public.source_revisions",
      ]) {
        assert.throws(() =>
          executeSql(database, `set role service_role; ${forbidden};`)
        );
      }
      assert.throws(() =>
        executeSql(database, `
          select * from public.save_intelligence_report(
            jsonb_build_object(
              'id', 'report_missing_snapshot',
              'workspaceId', 'workspace_one',
              'runId', '00000000-0000-4000-8000-000000000301'
            ),
            jsonb_build_array(jsonb_build_object())
          );
        `)
      );
      assert.throws(() =>
        executeSql(database, `
          select * from public.save_intelligence_report(
            jsonb_build_object(
              'id', 'report_mismatch',
              'workspaceId', 'workspace_one',
              'runId', '00000000-0000-4000-8000-000000000301',
              'companyCount', 3,
              'eligibleSnapshotCount', 3,
              'eligibleSnapshotFingerprint', 'snapshot:mismatch'
            ),
            '[]'::jsonb
          );
        `)
      );
      executeSql(database, `
        insert into public.scan_runs (
          id, workspace_id, mode, status
        ) values (
          '00000000-0000-4000-8000-000000000301',
          'workspace_one', 'structured', 'running'
        );
        insert into public.companies (workspace_id, id, name)
        select 'workspace_one', 'snapshot_company_' || n, 'Company ' || n
        from generate_series(1, 3) as n;
        insert into public.deals (
          workspace_id, id, company_id, company_name, status
        )
        select 'workspace_one', 'snapshot_deal_' || n,
          'snapshot_company_' || n, 'Company ' || n, 'screening'
        from generate_series(1, 3) as n;
      `);
      assert.equal(
        executeSql(database, `
          with analyses as (
            select jsonb_agg(jsonb_build_object(
              'id', 'snapshot_analysis_' || n,
              'reportId', 'report_snapshot_three',
              'runId', '00000000-0000-4000-8000-000000000301',
              'dealId', 'snapshot_deal_' || n,
              'companyName', 'Company ' || n,
              'dealStatus', 'screening',
              'outcome', 'no_material_change',
              'confidence', 'low',
              'score', 0,
              'investmentMemory', '{}'::jsonb,
              'marketEvidence', '{}'::jsonb,
              'implications', '{}'::jsonb,
              'recommendedNextMove', 'Continue monitoring.',
              'companyBrief', '{}'::jsonb,
              'sourceRefs', '[]'::jsonb,
              'createdAt', '2026-07-28T14:00:00.000Z'
            )) as payload
            from generate_series(1, 3) as n
          )
          select count(*)
          from analyses, public.save_intelligence_report(
            jsonb_build_object(
              'id', 'report_snapshot_three',
              'workspaceId', 'workspace_one',
              'runId', '00000000-0000-4000-8000-000000000301',
              'createdAt', '2026-07-28T14:00:00.000Z',
              'marketSummary', 'Snapshot test.',
              'opportunities', '[]'::jsonb,
              'analysisStatus', 'completed',
              'companyCount', 3,
              'beliefRevisedCount', 0,
              'monitorCount', 0,
              'noMaterialChangeCount', 3,
              'analysisUnavailableCount', 0,
              'evidenceCoverage', '{}'::jsonb,
              'eligibleSnapshotCount', 3,
              'eligibleSnapshotFingerprint', 'snapshot:three'
            ),
            analyses.payload
          );
        `),
        "1",
      );
      assert.throws(() =>
        executeSql(database, `
          select * from public.save_intelligence_report(
            jsonb_build_object(
              'id', 'report_snapshot_three',
              'workspaceId', 'workspace_one',
              'runId', '00000000-0000-4000-8000-000000000301',
              'companyCount', 0,
              'eligibleSnapshotCount', 0,
              'eligibleSnapshotFingerprint', 'snapshot:different'
            ),
            '[]'::jsonb
          );
        `)
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
        insert into public.source_documents (
          id, filename, title, role, checksum, byte_size, object_key
        ) values
          ('c', 'c.pdf', 'C', 'deal_document', 'hash_c', 1, 'private/c'),
          ('b:c', 'bc.pdf', 'BC', 'deal_document', 'hash_bc', 1, 'private/bc');
        insert into public.companies (workspace_id, id, name) values
          ('workspace_legacy', 'company_ab', 'AB'),
          ('workspace_legacy', 'company_a', 'A');
        insert into public.deals (
          workspace_id, id, company_id, company_name
        ) values
          ('workspace_legacy', 'a:b', 'company_ab', 'AB'),
          ('workspace_legacy', 'a', 'company_a', 'A');
        insert into public.source_evidence (
          workspace_id, id, document_id, deal_id, company_name,
          provenance, page, fact, excerpt
        ) values
          ('workspace_legacy', 'collision_one', 'c', 'a:b', 'AB',
            'source_document', 1, 'one', 'one'),
          ('workspace_legacy', 'collision_two', 'b:c', 'a', 'A',
            'source_document', 1, 'two', 'two');
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
          where revision.workspace_id = 'workspace_legacy'
            and assignment.deal_id = 'deal_legacy';
        `),
        "1|deal_legacy|screening|true|sha256:48d9ca8390d3d1782234507c24e57b3d4df79a8f216f7157697f68bfb564dc75",
      );
      assert.equal(
        executeSql(database, `
          select count(*) || '|' || count(distinct request_id)
          from public.deal_source_assignments
          where workspace_id = 'workspace_legacy'
            and deal_id in ('a', 'a:b');
        `),
        "2|2",
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
