import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const bootstrapPath = fileURLToPath(
  new URL("../../scripts/bootstrap-production-baseline.zsh", import.meta.url),
);
const bridgePath = fileURLToPath(
  new URL(
    "../../scripts/sql/upgrade-prototype-uploaded-documents-to-0007.sql",
    import.meta.url,
  ),
);
const workspaceCompositePath = fileURLToPath(
  new URL("../../drizzle/0008_workspace_composite_identity.sql", import.meta.url),
);
const registryPath = fileURLToPath(
  new URL("../../drizzle/0009_source_revision_deal_registry.sql", import.meta.url),
);
const baselineMigrations = [
  "0000_vsee_postgres.sql",
  "0001_remove_report_delivery.sql",
  "0002_durable_decision_lineage.sql",
  "0003_sanitize_report_next_steps.sql",
  "0004_company_analyses.sql",
  "0005_sample_decision_label.sql",
  "0006_reasoner_judgments.sql",
].map((filename) =>
  fileURLToPath(new URL(`../../drizzle/${filename}`, import.meta.url))
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
  const database =
    `vsee_production_bridge_${process.pid}_${randomUUID().replaceAll("-", "")}`;
  execFileSync("createdb", [database], { stdio: "pipe" });
  try {
    run(database);
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

function installPrototypeSchema(database: string): void {
  for (const migration of baselineMigrations) {
    applySql(database, migration);
  }
  executeSql(database, `
    create table public.uploaded_documents (
      id text primary key,
      workspace_id text not null
        references public.workspaces(id) on delete cascade,
      filename text not null,
      content_type text not null,
      byte_size bigint not null check (byte_size > 0),
      checksum text not null,
      object_key text not null,
      status text not null default 'queued' check (
        status in ('queued', 'extracting', 'ready', 'failed')
      ),
      failure_reason text,
      company_name text,
      headline text,
      extracted_facts jsonb not null default '[]'::jsonb,
      memory_texts jsonb not null default '[]'::jsonb,
      memory_ids jsonb not null default '[]'::jsonb,
      xtrace_job_id text,
      deal_id text,
      lease_expires_at timestamptz,
      worker_id text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (workspace_id, checksum)
    );
    create index uploaded_documents_workspace_created
      on public.uploaded_documents (workspace_id, created_at desc);
    create index uploaded_documents_claimable
      on public.uploaded_documents (status, lease_expires_at);
    alter table public.uploaded_documents enable row level security;
  `);
}

function insertPrototypeRow(
  database: string,
  values: {
    status: "queued" | "extracting" | "ready" | "failed";
    extractedFacts?: string;
    memoryTexts?: string;
    memoryIds?: string;
    workerId?: string;
  },
): void {
  executeSql(database, `
    insert into public.workspaces (id, name)
    values ('workspace_bridge', 'Bridge');
    insert into public.uploaded_documents (
      id, workspace_id, filename, content_type, byte_size, checksum,
      object_key, status, failure_reason, extracted_facts, memory_texts,
      memory_ids, worker_id
    ) values (
      'upload_bridge', 'workspace_bridge', 'bridge.pdf',
      'application/pdf', 42, 'checksum_bridge',
      'private/workspace_bridge/bridge.pdf', '${values.status}',
      'prototype failure',
      '${values.extractedFacts ?? "[]"}'::jsonb,
      '${values.memoryTexts ?? "[]"}'::jsonb,
      '${values.memoryIds ?? "[]"}'::jsonb,
      ${values.workerId ? `'${values.workerId}'` : "null"}
    );
  `);
}

test(
  "the production bridge upgrades an empty-payload failed prototype upload without losing legacy or shared fields",
  { skip: !canCreateTemporaryDatabase && !requirePostgres },
  () => {
    assert.equal(
      canCreateTemporaryDatabase,
      true,
      "PostgreSQL with temporary-database privileges is required.",
    );
    assert.equal(existsSync(bridgePath), true, "the 0007 compatibility bridge must exist");
    withTemporaryDatabase((database) => {
      installPrototypeSchema(database);
      insertPrototypeRow(database, {
        status: "failed",
        workerId: "stale-prototype-worker",
      });

      applySql(database, bridgePath);

      assert.equal(
        executeSql(database, `
          select id || '|' || workspace_id || '|' || filename || '|'
            || status || '|' || failure_reason || '|'
            || (extraction_preview is null)::text || '|' || worker_id
          from public.uploaded_documents;
        `),
        "upload_bridge|workspace_bridge|bridge.pdf|failed|prototype failure|true|stale-prototype-worker",
      );
      assert.equal(
        executeSql(database, `
          select count(*)
          from information_schema.columns
          where table_schema = 'public'
            and table_name = 'uploaded_documents'
            and column_name in (
              'company_name', 'headline', 'extracted_facts', 'memory_texts',
              'memory_ids', 'xtrace_job_id', 'deal_id'
            );
        `),
        "7",
      );
      assert.doesNotThrow(() =>
        executeSql(database, `
          insert into public.uploaded_documents (
            id, workspace_id, filename, content_type, byte_size, checksum,
            object_key, status
          ) values (
            'upload_current', 'workspace_bridge', 'current.pdf',
            'application/pdf', 43, 'checksum_current',
            'private/workspace_bridge/current.pdf', 'awaiting_confirmation'
          );
        `)
      );
    });
  },
);

test(
  "the production-shaped prototype bridge reaches 0009 when pgcrypto is installed in extensions",
  { skip: !canCreateTemporaryDatabase && !requirePostgres },
  () => {
    assert.equal(canCreateTemporaryDatabase, true);
    assert.equal(existsSync(bridgePath), true);
    withTemporaryDatabase((database) => {
      executeSql(database, `
        drop extension if exists pgcrypto cascade;
        create schema if not exists extensions;
        create extension pgcrypto with schema extensions;
      `);
      installPrototypeSchema(database);
      insertPrototypeRow(database, {
        status: "failed",
        workerId: "stale-production-worker",
      });

      applySql(database, bridgePath);
      applySql(database, workspaceCompositePath);
      applySql(database, registryPath);

      assert.equal(
        executeSql(database, `
          select public.sha256_length_framed(array['a', 'bc']);
        `),
        "sha256:5310a58788781ab25d5ad7c3f85035824b4eb7bdfa394e0ac2186271472b5492",
      );
      assert.equal(
        executeSql(database, `
          select
            to_regprocedure(
              'public.confirm_source_assignment(jsonb)'
            ) is not null
            and exists (
              select 1
              from information_schema.columns
              where table_schema = 'public'
                and table_name = 'uploaded_documents'
                and column_name = 'memory_texts'
            )
            and exists (
              select 1
              from information_schema.columns
              where table_schema = 'public'
                and table_name = 'uploaded_documents'
                and column_name = 'extraction_preview'
            );
        `),
        "t",
      );
    });
  },
);

test(
  "the guarded bootstrap classifies and upgrades the production-shaped prototype on real PostgreSQL",
  { skip: !canCreateTemporaryDatabase && !requirePostgres },
  () => {
    assert.equal(canCreateTemporaryDatabase, true);
    withTemporaryDatabase((database) => {
      executeSql(database, `
        drop extension if exists pgcrypto cascade;
        create schema if not exists extensions;
        create extension pgcrypto with schema extensions;
      `);
      installPrototypeSchema(database);
      insertPrototypeRow(database, {
        status: "failed",
        workerId: "stale-production-worker",
      });

      const fixtureDirectory = mkdtempSync(join(tmpdir(), "vsee-security-fixture-"));
      const securityPath = join(fixtureDirectory, "security");
      writeFileSync(
        securityPath,
        `#!/bin/sh\nprintf '%s' 'postgresql:///${database}'\n`,
        "utf8",
      );
      chmodSync(securityPath, 0o755);
      try {
        assert.doesNotThrow(() =>
          execFileSync("zsh", [bootstrapPath], {
            env: {
              ...process.env,
              PATH: `${fixtureDirectory}:${process.env.PATH ?? ""}`,
              USER: "fixture-user",
            },
            stdio: "pipe",
          })
        );
      } finally {
        rmSync(fixtureDirectory, { recursive: true, force: true });
      }

      assert.equal(
        executeSql(database, `
          select
            to_regprocedure(
              'public.confirm_source_assignment(jsonb)'
            ) is not null
            and exists (
              select 1 from pg_catalog.pg_constraint
              where conrelid = 'public.uploaded_documents'::regclass
                and contype = 'p'
                and pg_catalog.pg_get_constraintdef(oid)
                  = 'PRIMARY KEY (workspace_id, id)'
            );
        `),
        "t",
      );
    });
  },
);

test(
  "the production bridge refuses to discard meaningful prototype payload",
  { skip: !canCreateTemporaryDatabase && !requirePostgres },
  () => {
    assert.equal(canCreateTemporaryDatabase, true);
    assert.equal(existsSync(bridgePath), true);
    withTemporaryDatabase((database) => {
      installPrototypeSchema(database);
      insertPrototypeRow(database, {
        status: "failed",
        extractedFacts: '[{"text":"material fact","excerpt":"source"}]',
      });

      assert.throws(() => applySql(database, bridgePath));
      assert.equal(
        executeSql(database, `
          select
            exists (
              select 1 from information_schema.columns
              where table_schema = 'public'
                and table_name = 'uploaded_documents'
                and column_name = 'extracted_facts'
            )::text || '|' ||
            exists (
              select 1 from information_schema.columns
              where table_schema = 'public'
                and table_name = 'uploaded_documents'
                and column_name = 'extraction_preview'
            )::text || '|' ||
            jsonb_array_length(extracted_facts)::text
          from public.uploaded_documents;
        `),
        "true|false|1",
      );
    });
  },
);

test(
  "the production bridge refuses prototype rows whose ready or extracting state changed meaning",
  { skip: !canCreateTemporaryDatabase && !requirePostgres },
  () => {
    assert.equal(canCreateTemporaryDatabase, true);
    assert.equal(existsSync(bridgePath), true);
    for (const status of ["ready", "extracting"] as const) {
      withTemporaryDatabase((database) => {
        installPrototypeSchema(database);
        insertPrototypeRow(database, { status });

        assert.throws(() => applySql(database, bridgePath));
        assert.equal(
          executeSql(database, `
            select status || '|' ||
              exists (
                select 1 from information_schema.columns
                where table_schema = 'public'
                  and table_name = 'uploaded_documents'
                  and column_name = 'extraction_preview'
              )::text
            from public.uploaded_documents;
          `),
          `${status}|false`,
        );
      });
    }
  },
);
