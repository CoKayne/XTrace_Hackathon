import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";

interface MigrationJournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

const task6MigrationName = "0013_confirmed_upload_ingest.sql";
const migrationPath = fileURLToPath(
  new URL(`../../drizzle/${task6MigrationName}`, import.meta.url),
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
  version: "7",
  when: 1785369431000,
  tag: "0012_source_grounded_underwriting",
  breakpoints: true,
};
const validTask6JournalEntry: MigrationJournalEntry = {
  idx: 13,
  version: "7",
  when: 1785373200000,
  tag: "0013_confirmed_upload_ingest",
  breakpoints: true,
};

function validatedTaskMigrationNames(
  entries: MigrationJournalEntry[],
  task13MigrationExists: boolean,
): string[] {
  const task6Indices = entryIndices(
    entries,
    validTask6JournalEntry.tag,
  );
  assert.equal(
    task6Indices.length,
    1,
    "Task 6 requires one exact journal entry.",
  );
  const task6Index = task6Indices[0];
  const task6Entry = entries[task6Index];
  assert.deepEqual(
    journalIdentity(task6Entry),
    journalIdentity(validTask6JournalEntry),
  );

  const task13Indices = entryIndices(
    entries,
    reservedTask13JournalEntry.tag,
  );
  if (!task13MigrationExists) {
    assert.equal(
      task13Indices.length,
      0,
      "Task 13 cannot be journaled while its migration file is absent.",
    );
    assert.ok(
      reservedTask13JournalEntry.when < task6Entry.when,
      "Task 6 migration timestamp must follow reserved Task 13.",
    );
    return [task6MigrationName];
  }

  assert.equal(
    task13Indices.length,
    1,
    "Task 13 requires one exact journal entry.",
  );
  const task13Index = task13Indices[0];
  const task13Entry = entries[task13Index];
  assert.deepEqual(
    task13Entry,
    reservedTask13JournalEntry,
  );
  assert.ok(
    task13Index < task6Index,
    "Task 13 must physically precede Task 6 in the journal.",
  );
  assert.ok(
    task13Entry.when < task6Entry.when,
    "Task 6 migration timestamp must follow Task 13.",
  );
  const taskEntryIndices = new Set([task13Index, task6Index]);
  return entries.flatMap((entry, index) =>
    taskEntryIndices.has(index) ? [`${entry.tag}.sql`] : []
  );
}

function entryIndices(
  entries: MigrationJournalEntry[],
  tag: string,
): number[] {
  return entries.flatMap((entry, index) =>
    entry.tag === tag ? [index] : []
  );
}

function journalIdentity(entry: MigrationJournalEntry) {
  return {
    idx: entry.idx,
    version: entry.version,
    tag: entry.tag,
    breakpoints: entry.breakpoints,
  };
}

function readMigrationJournalEntries(): MigrationJournalEntry[] {
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: MigrationJournalEntry[];
  };
  return journal.entries;
}
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

test("task migration journal guard rejects malformed metadata and physical order", () => {
  const validEntries = [
    { ...reservedTask13JournalEntry },
    { ...validTask6JournalEntry },
  ];
  assert.deepEqual(
    validatedTaskMigrationNames(validEntries, true),
    [task13MigrationName, task6MigrationName],
  );
  assert.deepEqual(
    validatedTaskMigrationNames([{ ...validTask6JournalEntry }], false),
    [task6MigrationName],
  );

  const malformedCases: Array<[string, MigrationJournalEntry[]]> = [
    [
      "Task 13 version",
      [{ ...reservedTask13JournalEntry, version: "6" }, validEntries[1]],
    ],
    [
      "Task 6 version",
      [validEntries[0], { ...validTask6JournalEntry, version: "6" }],
    ],
    [
      "Task 13 breakpoints",
      [{ ...reservedTask13JournalEntry, breakpoints: false }, validEntries[1]],
    ],
    [
      "Task 6 breakpoints",
      [validEntries[0], { ...validTask6JournalEntry, breakpoints: false }],
    ],
    [
      "Task 13 identity",
      [{ ...reservedTask13JournalEntry, idx: 11 }, validEntries[1]],
    ],
    [
      "Task 13 tag",
      [
        {
          ...reservedTask13JournalEntry,
          tag: "0012_mislabeled",
        },
        validEntries[1],
      ],
    ],
    [
      "Task 6 identity",
      [validEntries[0], { ...validTask6JournalEntry, idx: 12 }],
    ],
    [
      "Task 6 tag",
      [
        validEntries[0],
        {
          ...validTask6JournalEntry,
          tag: "0013_mislabeled",
        },
      ],
    ],
    [
      "non-increasing timestamp",
      [
        validEntries[0],
        {
          ...validTask6JournalEntry,
          when: reservedTask13JournalEntry.when,
        },
      ],
    ],
    ["physically reversed order", [...validEntries].reverse()],
  ];
  for (const [label, entries] of malformedCases) {
    assert.throws(
      () => validatedTaskMigrationNames(entries, true),
      label,
    );
  }
});

test("Task 6 migration is additive and journaled after the reserved Task 13 migration number", () => {
  assert.equal(existsSync(migrationPath), true);
  const task13MigrationExists = existsSync(task13MigrationPath);
  validatedTaskMigrationNames(
    readMigrationJournalEntries(),
    task13MigrationExists,
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
      const taskMigrations = validatedTaskMigrationNames(
        readMigrationJournalEntries(),
        existsSync(task13MigrationPath),
      );
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
        ...taskMigrations,
      ]) {
        execFileSync("psql", [
          "-v",
          "ON_ERROR_STOP=1",
          "-d",
          database,
          "-f",
          fileURLToPath(new URL(`../../drizzle/${migration}`, import.meta.url)),
        ], { stdio: "pipe" });
        if (migration === task13MigrationName) {
          execFileSync("psql", [
            "-v",
            "ON_ERROR_STOP=1",
            "-d",
            database,
            "-c",
            `
              insert into public.workspaces (id, name)
              values ('workspace_backfill', 'Backfill');
              insert into public.companies (
                id, workspace_id, name
              ) values (
                'company_backfill', 'workspace_backfill', 'Backfill Co'
              );
              insert into public.deals (
                id, workspace_id, company_id, company_name, status
              ) values (
                'deal_backfill', 'workspace_backfill', 'company_backfill',
                'Backfill Co', 'evaluating'
              );
              insert into public.source_revisions (
                id, workspace_id, source_id, revision, content_hash,
                object_key, object_version, content_type, extractor_id,
                extractor_version, extracted_at, supersedes_revision_id
              ) values (
                'revision_backfill', 'workspace_backfill', 'source_backfill',
                1, 'hash-backfill', 'private/backfill.md', 'object:v1',
                'text/markdown', 'plain_text_v1', '1',
                '2026-07-29T11:00:00.000Z', null
              );
              select public.save_source_evidence_items(jsonb_build_array(
                jsonb_build_object(
                  'id', 'evidence_backfill',
                  'workspaceId', 'workspace_backfill',
                  'dealId', 'deal_backfill',
                  'sourceRevisionId', 'revision_backfill',
                  'provenanceOrigin', 'uploaded_document',
                  'field', 'unstructured_source_fact',
                  'value', 'Legacy canonical row.',
                  'unit', null,
                  'currency', null,
                  'periodStart', null,
                  'periodEnd', null,
                  'publishedAt', null,
                  'eventAt', null,
                  'retrievedAt', '2026-07-29T11:00:00.000Z',
                  'locator', jsonb_build_object(
                    'kind', 'text_range', 'start', 0, 'end', 21,
                    'excerpt', 'Legacy canonical row.'
                  ),
                  'sourceRole', 'management',
                  'assertionStatus', 'reported',
                  'verificationMethod', null,
                  'freshness', 'current',
                  'acceptedForGate', false
                )
              ));
            `,
          ], { stdio: "pipe" });
        }
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
              'fact', 'ARR was $2,000,000.',
              'excerpt', 'ARR was $2,000,000.',
              'page', 1,
              'locator', jsonb_build_object(
                'kind', 'text_range',
                'start', 0,
                'end', 21,
                'excerpt', 'ARR was $2,000,000.'
              ),
              'structured', jsonb_build_object(
                'field', 'ARR',
                'value', '$2,000,000',
                'unit', 'currency',
                'currency', 'USD',
                'periodStart', '2025-01-01',
                'periodEnd', '2025-12-31',
                'publishedAt', null,
                'eventAt', null
              )
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
             where workspace_id = 'workspace_upload') || '|' ||
            (select count(*) from public.source_evidence_items
             where workspace_id = 'workspace_upload') || '|' ||
            (select item.source_id || ':' || item.source_revision_id || ':' ||
                    (item.payload ->> 'field') || ':' ||
                    (item.payload ->> 'acceptedForGate')
             from public.source_evidence_items as item
             where item.workspace_id = 'workspace_upload'
               and item.evidence_id = 'evidence_1') || '|' ||
            (select item.source_id || ':' ||
                    (item.payload ->> 'sourceId')
             from public.source_evidence_items as item
             where item.workspace_id = 'workspace_backfill'
               and item.evidence_id = 'evidence_backfill')
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
        "confirmed|failed|deal_1|revision_1|1|1|1|1|source_1:revision_1:ARR:true|source_backfill:source_backfill",
      );
    } finally {
      execFileSync("dropdb", ["--if-exists", database], { stdio: "pipe" });
    }
  },
);
