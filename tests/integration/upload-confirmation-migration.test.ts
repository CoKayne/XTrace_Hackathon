import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";

const migrationPath = fileURLToPath(
  new URL("../../drizzle/0013_confirmed_upload_ingest.sql", import.meta.url),
);
const task13MigrationName = "0012_source_grounded_underwriting.sql";
const task13MigrationPath = fileURLToPath(
  new URL(`../../drizzle/${task13MigrationName}`, import.meta.url),
);
const journalPath = fileURLToPath(
  new URL("../../drizzle/meta/_journal.json", import.meta.url),
);
const reservedTask13JournalEntry = {
  idx: 12,
  when: 1785369431000,
};
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
    entries: Array<{
      idx: number;
      version: string;
      when: number;
      tag: string;
      breakpoints: boolean;
    }>;
  };
  const task13MigrationExists = existsSync(task13MigrationPath);
  const task13Entry = journal.entries.find((entry) =>
    entry.tag === "0012_source_grounded_underwriting"
  );
  const task6Entry = journal.entries.find((entry) =>
    entry.tag === "0013_confirmed_upload_ingest"
  );
  if (task13MigrationExists) {
    assert.ok(
      task13Entry,
      "Task 13 migration file requires its exact journal entry.",
    );
    assert.equal(task13Entry.idx, reservedTask13JournalEntry.idx);
    assert.equal(task13Entry.when, reservedTask13JournalEntry.when);
  }
  assert.ok(task6Entry);
  const task13OrderEntry = task13MigrationExists
    ? task13Entry!
    : reservedTask13JournalEntry;
  assert.deepEqual(
    [task13OrderEntry.idx, task6Entry.idx],
    [12, 13],
  );
  assert.ok(
    task13OrderEntry.when < task6Entry.when,
    "Task 6 migration timestamp must follow Task 13.",
  );
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
        ...(existsSync(task13MigrationPath) ? [task13MigrationName] : []),
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
          select public.confirm_uploaded_document(jsonb_build_object(
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
          ));
          select count(*)
          from public.claim_next_uploaded_document(
            'confirmed', 'worker-a', 300
          );
          insert into public.uploaded_documents (
            id, workspace_id, filename, content_type, byte_size, checksum,
            object_key, status
          ) values (
            'upload_2', 'workspace_upload', 'second.txt', 'text/plain', 20,
            'content-hash-two', 'private/workspace_upload/second.txt',
            'queued'
          );
          do $lease_test$
          declare
            lease_token uuid;
            transitioned boolean;
          begin
            update public.uploaded_documents
            set lease_expires_at = clock_timestamp() - interval '1 second'
            where workspace_id = 'workspace_upload' and id = 'upload_1';
            select public.transition_uploaded_document_lease(
              'workspace_upload', 'upload_1', 'worker-a',
              (select upload.lease_token
               from public.uploaded_documents as upload
               where upload.workspace_id = 'workspace_upload'
                 and upload.id = 'upload_1'),
              'confirmed_complete', null, null
            ) into transitioned;
            if transitioned then
              raise exception 'expired confirmed completion succeeded';
            end if;
            select public.transition_uploaded_document_lease(
              'workspace_upload', 'upload_1', 'worker-a',
              (select upload.lease_token
               from public.uploaded_documents as upload
               where upload.workspace_id = 'workspace_upload'
                 and upload.id = 'upload_1'),
              'confirmed_fail', null, 'expired confirmed failure'
            ) into transitioned;
            if transitioned then
              raise exception 'expired confirmed failure succeeded';
            end if;
            perform *
            from public.claim_next_uploaded_document(
              'confirmed', 'worker-b', 300
            );
            select upload.lease_token into lease_token
            from public.uploaded_documents as upload
            where upload.workspace_id = 'workspace_upload'
              and upload.id = 'upload_1';
            select public.transition_uploaded_document_lease(
              'workspace_upload', 'upload_1', 'worker-b', lease_token,
              'confirmed_complete', null, null
            ) into transitioned;
            if not transitioned then
              raise exception 'reclaimed confirmed completion failed';
            end if;

            update public.uploaded_documents
            set status = 'ingesting_memory',
                worker_id = 'expired-confirmed-fail',
                lease_token = gen_random_uuid(),
                lease_expires_at = clock_timestamp() - interval '1 second'
            where workspace_id = 'workspace_upload' and id = 'upload_1';
            select public.transition_uploaded_document_lease(
              'workspace_upload', 'upload_1', 'expired-confirmed-fail',
              (select upload.lease_token
               from public.uploaded_documents as upload
               where upload.workspace_id = 'workspace_upload'
                 and upload.id = 'upload_1'),
              'confirmed_fail', null, 'expired confirmed failure'
            ) into transitioned;
            if transitioned then
              raise exception 'second expired confirmed failure succeeded';
            end if;
            perform *
            from public.claim_next_uploaded_document(
              'confirmed', 'worker-c', 300
            );
            select upload.lease_token into lease_token
            from public.uploaded_documents as upload
            where upload.workspace_id = 'workspace_upload'
              and upload.id = 'upload_1';
            select public.transition_uploaded_document_lease(
              'workspace_upload', 'upload_1', 'worker-c', lease_token,
              'confirmed_fail', null, 'retryable provider failure'
            ) into transitioned;
            if not transitioned then
              raise exception 'reclaimed confirmed failure failed';
            end if;

            perform *
            from public.claim_next_uploaded_document(
              'queued', 'extractor-a', 300
            );
            update public.uploaded_documents
            set lease_expires_at = clock_timestamp() - interval '1 second'
            where workspace_id = 'workspace_upload' and id = 'upload_2';
            select public.transition_uploaded_document_lease(
              'workspace_upload', 'upload_2', 'extractor-a',
              (select upload.lease_token
               from public.uploaded_documents as upload
               where upload.workspace_id = 'workspace_upload'
                 and upload.id = 'upload_2'),
              'extraction_complete',
              '{"candidateCompanyName":"Second","candidateHeadline":null,"facts":[],"extractionMetadata":{"extractorId":"plain_text_v1","extractorVersion":"1","extractedAt":"2026-07-29T12:10:00.000Z"}}',
              null
            ) into transitioned;
            if transitioned then
              raise exception 'expired extraction completion succeeded';
            end if;
            select public.transition_uploaded_document_lease(
              'workspace_upload', 'upload_2', 'extractor-a',
              (select upload.lease_token
               from public.uploaded_documents as upload
               where upload.workspace_id = 'workspace_upload'
                 and upload.id = 'upload_2'),
              'extraction_fail', null, 'expired extraction failure'
            ) into transitioned;
            if transitioned then
              raise exception 'expired extraction failure succeeded';
            end if;
            perform *
            from public.claim_next_uploaded_document(
              'queued', 'extractor-b', 300
            );
            select upload.lease_token into lease_token
            from public.uploaded_documents as upload
            where upload.workspace_id = 'workspace_upload'
              and upload.id = 'upload_2';
            select public.transition_uploaded_document_lease(
              'workspace_upload', 'upload_2', 'extractor-b', lease_token,
              'extraction_complete',
              '{"candidateCompanyName":"Second","candidateHeadline":null,"facts":[],"extractionMetadata":{"extractorId":"plain_text_v1","extractorVersion":"1","extractedAt":"2026-07-29T12:10:00.000Z"}}',
              null
            ) into transitioned;
            if not transitioned then
              raise exception 'reclaimed extraction completion failed';
            end if;

            update public.uploaded_documents
            set status = 'extracting',
                extraction_preview = null,
                failure_reason = null,
                worker_id = 'expired-extraction-fail',
                lease_token = gen_random_uuid(),
                lease_expires_at = clock_timestamp() - interval '1 second'
            where workspace_id = 'workspace_upload' and id = 'upload_2';
            select public.transition_uploaded_document_lease(
              'workspace_upload', 'upload_2', 'expired-extraction-fail',
              (select upload.lease_token
               from public.uploaded_documents as upload
               where upload.workspace_id = 'workspace_upload'
                 and upload.id = 'upload_2'),
              'extraction_fail', null, 'expired extraction failure'
            ) into transitioned;
            if transitioned then
              raise exception 'second expired extraction failure succeeded';
            end if;
            perform *
            from public.claim_next_uploaded_document(
              'queued', 'extractor-c', 300
            );
            select upload.lease_token into lease_token
            from public.uploaded_documents as upload
            where upload.workspace_id = 'workspace_upload'
              and upload.id = 'upload_2';
            select public.transition_uploaded_document_lease(
              'workspace_upload', 'upload_2', 'extractor-c', lease_token,
              'extraction_fail', null, 'terminal extraction failure'
            ) into transitioned;
            if not transitioned then
              raise exception 'reclaimed extraction failure failed';
            end if;
          end
          $lease_test$;
          select confirmed.status || '|' || extraction.status || '|' ||
            confirmed.deal_id || '|' || confirmed.source_revision_id || '|' ||
            (select count(*) from public.source_revisions
             where workspace_id = 'workspace_upload') || '|' ||
            (select count(*) from public.deal_source_assignments
             where workspace_id = 'workspace_upload') || '|' ||
            (select count(*) from public.source_evidence
             where workspace_id = 'workspace_upload')
          from public.uploaded_documents as confirmed
          cross join public.uploaded_documents as extraction
          where confirmed.workspace_id = 'workspace_upload'
            and confirmed.id = 'upload_1'
            and extraction.workspace_id = 'workspace_upload'
            and extraction.id = 'upload_2';
        `,
      ], { encoding: "utf8" }).trim();
      assert.equal(
        output,
        "confirmed|failed|deal_1|revision_1|1|1|1",
      );
    } finally {
      execFileSync("dropdb", ["--if-exists", database], { stdio: "pipe" });
    }
  },
);
