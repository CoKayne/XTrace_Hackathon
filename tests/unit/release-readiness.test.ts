import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const repositoryRoot = new URL("../../", import.meta.url);

const migrationNames = [
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
  "0012_source_grounded_underwriting.sql",
  "0013_confirmed_upload_ingest.sql",
  "0014_read_api_action_drafts.sql",
  "0015_framework_catalog_checkpoint.sql",
];

const migrationTestNames = [
  "tests/integration/report-next-step-migration.test.ts",
  "tests/integration/company-analyses-migration.test.ts",
  "tests/integration/workspace-composite-migration.test.ts",
  "tests/integration/schema-migrations.test.ts",
  "tests/integration/underwriting-reference-migration.test.ts",
  "tests/integration/upload-confirmation-migration.test.ts",
  "tests/integration/action-draft-migration.test.ts",
  "tests/integration/framework-catalog-checkpoint-migration.test.ts",
];

test("release migration verification is serial and includes every migration suite", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("package.json", repositoryRoot), "utf8"),
  ) as { scripts?: Record<string, string> };
  const command = packageJson.scripts?.["test:migrations"] ?? "";

  assert.match(command, /^REQUIRE_POSTGRES_MIGRATION_TESTS=1\s+/);
  assert.match(command, /--test-concurrency=1(?:\s|$)/);
  let previous = -1;
  for (const testName of migrationTestNames) {
    const position = command.indexOf(testName);
    assert.ok(position > previous, `${testName} must run once in release order`);
    assert.equal(
      command.split(testName).length - 1,
      1,
      `${testName} must occur exactly once`,
    );
    previous = position;
  }
});

test("the physical migration chain is contiguous from 0000 through 0015", async () => {
  const actual = (await readdir(new URL("drizzle/", repositoryRoot)))
    .filter((filename) => /^\d{4}_.+\.sql$/.test(filename))
    .sort();

  assert.deepEqual(actual, migrationNames);
});

test("journaled forward migrations preserve physical order and include 0010 through 0015", async () => {
  const journal = JSON.parse(
    await readFile(
      new URL("drizzle/meta/_journal.json", repositoryRoot),
      "utf8",
    ),
  ) as { entries: Array<{ idx: number; tag: string; when: number }> };
  const actualForwardEntries = journal.entries.map(({ tag }) => tag);
  const physicalTags = migrationNames.map((filename) =>
    filename.replace(/\.sql$/, "")
  );

  assert.deepEqual(
    actualForwardEntries.filter((tag) => /^001[0-5]_/.test(tag)),
    physicalTags.slice(10),
  );
  let previousPhysicalPosition = -1;
  for (const tag of actualForwardEntries) {
    const physicalPosition = physicalTags.indexOf(tag);
    assert.ok(
      physicalPosition > previousPhysicalPosition,
      `${tag} must preserve physical migration order`,
    );
    previousPhysicalPosition = physicalPosition;
  }
  for (let index = 1; index < journal.entries.length; index += 1) {
    assert.ok(journal.entries[index]!.idx > journal.entries[index - 1]!.idx);
    assert.ok(
      journal.entries[index]!.when > journal.entries[index - 1]!.when,
    );
  }
});
