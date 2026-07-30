import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";

const migrationPath = fileURLToPath(
  new URL("../../drizzle/0013_confirmed_upload_ingest.sql", import.meta.url),
);
const journalPath = fileURLToPath(
  new URL("../../drizzle/meta/_journal.json", import.meta.url),
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

test("Task 6 migration is additive and journaled after the reserved Task 13 migration number", () => {
  assert.equal(existsSync(migrationPath), true);
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  assert.deepEqual(journal.entries.at(-1), {
    idx: 13,
    version: "7",
    when: 1785373200000,
    tag: "0013_confirmed_upload_ingest",
    breakpoints: true,
  });
});

test(
  "0013 atomically promotes confirmation and enforces lease capabilities",
  { skip: !canCreateTemporaryDatabase && !requirePostgres },
  () => {
    assert.equal(
      canCreateTemporaryDatabase,
      true,
      "PostgreSQL with temporary-database privileges is required.",
    );
    const database = `vsee_upload_${process.pid}_${
      randomUUID().replaceAll("-", "")
    }`;
    execFileSync("createdb", [database], { stdio: "pipe" });
    try {
      for (const migration of [
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
        "0010_underwriting_references.sql",
        "0011_underwriting_runs.sql",
        "0013_confirmed_upload_ingest.sql",
      ]) {
        execFileSync("psql", [
          "-v",
          "ON_ERROR_STOP=1",
          "-d",
          database,
          "-f",
          fileURLToPath(new URL(`../../drizzle/${migration}`, import.meta.url)),
        ], { stdio: "pipe" });
      }
      const output = execFileSync("psql", [
        "-v",
        "ON_ERROR_STOP=1",
        "-d",
        database,
        "-AtF",
        "|",
        "-c",
        `
          insert into public.workspaces (id, name)
          values ('workspace_upload', 'Upload');
          insert into public.uploaded_documents (
            id, workspace_id, filename, content_type, byte_size, checksum,
            object_key, status, extraction_preview
          ) values (
            'upload_1', 'workspace_upload', 'acme.txt', 'text/plain', 20,
            'content-hash', 'private/workspace_upload/acme.txt',
            'awaiting_confirmation',
            '{"extractionMetadata":{"extractorId":"plain_text_v1","extractorVersion":"1","extractedAt":"2026-07-29T12:00:00.000Z"}}'
          );
          select (public.confirm_uploaded_document(jsonb_build_object(
            'workspaceId', 'workspace_upload',
            'uploadId', 'upload_1',
            'confirmationFingerprint', 'sha256:${"a".repeat(64)}',
            'dealId', 'deal_1',
            'companyId', 'company_1',
            'companyName', 'Acme',
            'dealStatus', 'evaluating',
            'sourceId', 'source_1',
            'sourceRevisionId', 'revision_1',
            'assignedByUserId', 'user_1',
            'confirmedAt', '2026-07-29T12:05:00.000Z',
            'evidence', jsonb_build_array(jsonb_build_object(
              'id', 'evidence_1',
              'fact', 'Acme serves carriers.',
              'excerpt', 'Acme serves carriers.',
              'page', 1
            ))
          )) -> 'upload' ->> 'status');
          select status || '|' || deal_id || '|' || source_revision_id
          from public.uploaded_documents
          where workspace_id = 'workspace_upload' and id = 'upload_1';
          select count(*) || '|' ||
            (select count(*) from public.deal_source_assignments
             where workspace_id = 'workspace_upload') || '|' ||
            (select count(*) from public.source_evidence
             where workspace_id = 'workspace_upload')
          from public.source_revisions
          where workspace_id = 'workspace_upload';
          select worker_id || '|' || (lease_token is not null)::text
          from public.claim_next_uploaded_document(
            'confirmed', 'worker-a', 300
          );
          select count(*)
          from public.claim_next_uploaded_document(
            'confirmed', 'worker-b', 300
          );
        `,
      ], { encoding: "utf8" }).trim();
      assert.deepEqual(output.split("\n"), [
        "confirmed",
        "confirmed|deal_1|revision_1",
        "1|1|1",
        "worker-a|true",
        "0",
      ]);
    } finally {
      execFileSync("dropdb", ["--if-exists", database], { stdio: "pipe" });
    }
  },
);
