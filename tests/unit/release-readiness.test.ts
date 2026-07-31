import assert from "node:assert/strict";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const repositoryRoot = new URL("../../", import.meta.url);
const migrationLauncherSourcePath = new URL(
  "../../scripts/apply-production-migrations.zsh",
  import.meta.url,
).pathname;
const libpqServiceRendererSourcePath = new URL(
  "../../scripts/render-private-libpq-service.mjs",
  import.meta.url,
).pathname;
const catalogManifestSourcePath = new URL(
  "../../scripts/sql/production-baseline-catalog-manifest.sql",
  import.meta.url,
).pathname;
const catalogHasherSourcePath = new URL(
  "../../scripts/hash-stdin-sha256.mjs",
  import.meta.url,
).pathname;
const registryInvariantsSourcePath = new URL(
  "../../scripts/sql/production-registry-data-invariants.sql",
  import.meta.url,
).pathname;

type CommandResult = { exitCode: number | null; output: string };

async function runCommand(
  command: string,
  arguments_: string[],
  environment: NodeJS.ProcessEnv,
): Promise<CommandResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, { env: environment });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (exitCode) => resolve({ exitCode, output }));
  });
}

async function writeExecutable(path: string, contents: string): Promise<void> {
  await writeFile(path, contents, "utf8");
  await chmod(path, 0o755);
}

const productionMigrationFiles = [
  "0010_underwriting_references.sql",
  "0011_underwriting_runs.sql",
  "0012_source_grounded_underwriting.sql",
  "0013_confirmed_upload_ingest.sql",
  "0014_read_api_action_drafts.sql",
  "0015_framework_catalog_checkpoint.sql",
  "0016_confirmed_upload_source_evidence_bridge.sql",
  "0017_public_sandbox_test_generations.sql",
];

test("the production migration launcher remains directly executable", async () => {
  const launcherMode = (await stat(migrationLauncherSourcePath)).mode;
  assert.equal(
    launcherMode & 0o111,
    0o111,
    "scripts/apply-production-migrations.zsh must remain executable",
  );
});

async function createMigrationRepositoryFixture(t: test.TestContext): Promise<{
  root: string;
  launcherPath: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "vsee-migration-repository-"));
  const scriptsDirectory = join(root, "scripts");
  const scriptsSqlDirectory = join(scriptsDirectory, "sql");
  const drizzleDirectory = join(root, "drizzle");
  const launcherPath = join(scriptsDirectory, "apply-production-migrations.zsh");
  await mkdir(scriptsDirectory, { recursive: true });
  await mkdir(scriptsSqlDirectory, { recursive: true });
  await mkdir(drizzleDirectory, { recursive: true });
  await Promise.all(
    productionMigrationFiles.map((filename) =>
      writeFile(join(drizzleDirectory, filename), "-- fixture migration\n", "utf8")
    ),
  );
  await copyFile(migrationLauncherSourcePath, launcherPath);
  await copyFile(
    libpqServiceRendererSourcePath,
    join(scriptsDirectory, "render-private-libpq-service.mjs"),
  );
  await copyFile(
    catalogManifestSourcePath,
    join(scriptsSqlDirectory, "production-baseline-catalog-manifest.sql"),
  );
  await copyFile(
    catalogHasherSourcePath,
    join(scriptsDirectory, "hash-stdin-sha256.mjs"),
  );
  await copyFile(
    registryInvariantsSourcePath,
    join(scriptsSqlDirectory, "production-registry-data-invariants.sql"),
  );
  const fixtureFingerprint = `sha256:${
    createHash("sha256").update("t").digest("hex")
  }`;
  await writeFile(
    join(scriptsDirectory, "production-catalog-fingerprints.zsh"),
    `#!/bin/zsh
readonly VSEE_CATALOG_PROTOTYPE="${fixtureFingerprint}"
readonly VSEE_CATALOG_0007="${fixtureFingerprint}"
readonly VSEE_CATALOG_BRIDGED_0007="${fixtureFingerprint}"
readonly VSEE_CATALOG_0008="${fixtureFingerprint}"
readonly VSEE_CATALOG_BRIDGED_0008="${fixtureFingerprint}"
readonly VSEE_CATALOG_0009="${fixtureFingerprint}"
readonly VSEE_CATALOG_BRIDGED_0009="${fixtureFingerprint}"
vsee_catalog_variant() { [[ "$1" == "${fixtureFingerprint}" ]] && print -- fixture; }
vsee_catalog_matches_stage() { [[ "$2" == "${fixtureFingerprint}" ]]; }
`,
    "utf8",
  );
  await chmod(launcherPath, 0o755);
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  return { root, launcherPath };
}

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
  "0016_confirmed_upload_source_evidence_bridge.sql",
  "0017_public_sandbox_test_generations.sql",
];

const migrationTestNames = [
  "tests/integration/report-next-step-migration.test.ts",
  "tests/integration/company-analyses-migration.test.ts",
  "tests/integration/production-baseline-bridge.test.ts",
  "tests/integration/workspace-composite-migration.test.ts",
  "tests/integration/schema-migrations.test.ts",
  "tests/integration/underwriting-reference-migration.test.ts",
  "tests/integration/upload-confirmation-migration.test.ts",
  "tests/integration/action-draft-migration.test.ts",
  "tests/integration/framework-catalog-checkpoint-migration.test.ts",
  "tests/integration/public-sandbox-reset-migration.test.ts",
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

test("the physical migration chain is contiguous from 0000 through 0017", async () => {
  const actual = (await readdir(new URL("drizzle/", repositoryRoot)))
    .filter((filename) => /^\d{4}_.+\.sql$/.test(filename))
    .sort();

  assert.deepEqual(actual, migrationNames);
});

test("journaled forward migrations preserve physical order and include 0010 through 0017", async () => {
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
    actualForwardEntries.filter((tag) => /^001[0-7]_/.test(tag)),
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

test("production migration launcher inventories sentinels, applies from the first missing migration, and verifies each result", async (t) => {
  const { root, launcherPath } = await createMigrationRepositoryFixture(t);
  const fixtureDirectory = join(root, "bin");
  const tracePath = join(root, "trace.log");
  const appliedPath = join(root, "applied.log");
  const databaseUrl =
    "postgresql://fixture-user:do-not-print-this-database-url@db.example.test/postgres";
  await mkdir(fixtureDirectory, { recursive: true });
  await writeExecutable(
    join(fixtureDirectory, "security"),
    "#!/bin/sh\nprintf 'security %s\\n' \"$5\" >> \"$FAKE_TRACE\"\nprintf '%s' \"$FAKE_DATABASE_URL\"\n",
  );
  await writeExecutable(
    join(fixtureDirectory, "psql"),
    "#!/bin/sh\nargs=\"$*\"\ncase \"$args\" in *' -v ON_ERROR_STOP=1 '*) ;; *) exit 67;; esac\ncase \"$args\" in\n  *' -f '*)\n    file=\"\"\n    previous=\"\"\n    for argument in \"$@\"; do\n      if [ \"$previous\" = \"-f\" ]; then file=\"$argument\"; break; fi\n      previous=\"$argument\"\n    done\n    id=$(basename \"$file\" | cut -c1-4)\n    printf 'apply %s\\n' \"$id\" >> \"$FAKE_TRACE\"\n    printf '%s\\n' \"$id\" >> \"$FAKE_APPLIED\"\n    exit 0\n    ;;\nesac\nid=$(printf '%s\\n' \"$args\" | sed -n 's/.*vsee-sentinel: \\(00[0-9][0-9]\\).*/\\1/p')\nprintf 'query %s\\n' \"$id\" >> \"$FAKE_TRACE\"\nif [ \"$id\" = \"0009\" ] || [ \"$id\" -le \"$FAKE_INITIAL_COMPLETE\" ] || grep -qx \"$id\" \"$FAKE_APPLIED\" 2>/dev/null; then\n  printf 't\\n'\nelse\n  printf 'f\\n'\nfi\n",
  );

  const result = await runCommand("zsh", [launcherPath], {
    ...process.env,
    PATH: `${fixtureDirectory}:${process.env.PATH ?? ""}`,
    FAKE_TRACE: tracePath,
    FAKE_APPLIED: appliedPath,
    FAKE_DATABASE_URL: databaseUrl,
    FAKE_INITIAL_COMPLETE: "0011",
    USER: "fixture-user",
  });

  assert.equal(result.exitCode, 0);
  assert.doesNotMatch(result.output, new RegExp(databaseUrl));
  const trace = (await readFile(tracePath, "utf8")).trim().split("\n");
  assert.deepEqual(trace.slice(0, 10), [
    "security vsee-supabase-db-url",
    "query 0009",
    "query 0010",
    "query 0011",
    "query 0012",
    "query 0013",
    "query 0014",
    "query 0015",
    "query 0016",
    "query 0017",
  ]);
  for (const id of ["0012", "0013", "0014", "0015", "0016", "0017"]) {
    const applyIndex = trace.indexOf(`apply ${id}`);
    assert.ok(applyIndex > 0, `${id} must be applied`);
    assert.equal(trace[applyIndex + 1], `query ${id}`, `${id} must be verified after apply`);
  }
});

test("production migration launcher keeps the Keychain URI out of psql argv and removes its private service file", async (t) => {
  const { root, launcherPath } = await createMigrationRepositoryFixture(t);
  const fixtureDirectory = join(root, "bin");
  const argvPath = join(root, "psql-argv.log");
  const serviceDetailsPath = join(root, "service-details.log");
  const databaseUrl =
    "postgresql://fixture-user:argv-secret-value@db.example.test:5432/postgres";
  await mkdir(fixtureDirectory, { recursive: true });
  await writeExecutable(
    join(fixtureDirectory, "security"),
    "#!/bin/sh\nprintf '%s' \"$FAKE_DATABASE_URL\"\n",
  );
  await writeExecutable(
    join(fixtureDirectory, "psql"),
    `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_PSQL_ARGV"
if [ -n "\${PGSERVICEFILE:-}" ] && [ ! -s "$FAKE_SERVICE_DETAILS" ]; then
  mode=$(stat -f '%Lp' "$PGSERVICEFILE" 2>/dev/null || stat -c '%a' "$PGSERVICEFILE" 2>/dev/null)
  pass_mode=$(stat -f '%Lp' "$PGPASSFILE" 2>/dev/null || stat -c '%a' "$PGPASSFILE" 2>/dev/null)
  printf 'path=%s\\nmode=%s\\npass_path=%s\\npass_mode=%s\\nservice=%s\\n' "$PGSERVICEFILE" "$mode" "$PGPASSFILE" "$pass_mode" "\${PGSERVICE:-}" > "$FAKE_SERVICE_DETAILS"
fi
printf 't\\n'
`,
  );

  const result = await runCommand("zsh", [launcherPath], {
    ...process.env,
    PATH: `${fixtureDirectory}:${process.env.PATH ?? ""}`,
    FAKE_DATABASE_URL: databaseUrl,
    FAKE_PSQL_ARGV: argvPath,
    FAKE_SERVICE_DETAILS: serviceDetailsPath,
    USER: "fixture-user",
  });

  assert.equal(result.exitCode, 0);
  assert.doesNotMatch(result.output, new RegExp(databaseUrl));
  const argvLog = await readFile(argvPath, "utf8");
  assert.doesNotMatch(argvLog, /argv-secret-value/);
  assert.doesNotMatch(argvLog, /postgres(?:ql)?:\/\//);
  const serviceDetails = await readFile(serviceDetailsPath, "utf8");
  assert.match(serviceDetails, /^path=.+$/m);
  assert.match(serviceDetails, /^mode=600$/m);
  assert.match(serviceDetails, /^pass_path=.+$/m);
  assert.match(serviceDetails, /^pass_mode=600$/m);
  assert.match(serviceDetails, /^service=vsee-production$/m);
  const serviceFilePath = serviceDetails.match(/^path=(.+)$/m)?.[1];
  const passwordFilePath = serviceDetails.match(/^pass_path=(.+)$/m)?.[1];
  assert.ok(serviceFilePath);
  assert.ok(passwordFilePath);
  await assert.rejects(readFile(serviceFilePath, "utf8"));
  await assert.rejects(readFile(passwordFilePath, "utf8"));
});

test("production launchers suppress inherited zsh tracing before reading the Keychain secret", async (t) => {
  const { root, launcherPath } = await createMigrationRepositoryFixture(t);
  const fixtureDirectory = join(root, "bin");
  const tracePath = join(root, "trace.log");
  const databaseUrl =
    "postgresql://fixture-user:must-not-appear-in-xtrace@db.example.test:5432/postgres";
  await mkdir(fixtureDirectory, { recursive: true });
  await writeExecutable(
    join(fixtureDirectory, "security"),
    "#!/bin/sh\nprintf '%s' \"$FAKE_DATABASE_URL\"\n",
  );
  await writeExecutable(
    join(fixtureDirectory, "psql"),
    "#!/bin/sh\nprintf 't\\n'\n",
  );

  const result = await runCommand("zsh", ["-x", launcherPath], {
    ...process.env,
    PATH: `${fixtureDirectory}:${process.env.PATH ?? ""}`,
    FAKE_DATABASE_URL: databaseUrl,
    FAKE_TRACE: tracePath,
    USER: "fixture-user",
  });

  assert.equal(result.exitCode, 0, result.output);
  assert.doesNotMatch(result.output, /must-not-appear-in-xtrace/);
  assert.doesNotMatch(result.output, /postgres(?:ql)?:\/\//);
});

test("private libpq renderer rejects a missing host, username, or database name", async (t) => {
  for (const scenario of [
    { name: "host", uri: "postgresql:///postgres" },
    { name: "username", uri: "postgresql://db.example.test/postgres" },
    { name: "database", uri: "postgresql://fixture-user@db.example.test/" },
  ]) {
    await t.test(scenario.name, async (subtest) => {
      const root = await mkdtemp(join(tmpdir(), "vsee-libpq-renderer-"));
      subtest.after(async () => {
        await rm(root, { recursive: true, force: true });
      });
      const servicePath = join(root, "pg_service.conf");
      const passwordPath = join(root, "pgpass");
      const result = spawnSync(
        process.execPath,
        [libpqServiceRendererSourcePath, servicePath, passwordPath],
        {
          input: scenario.uri,
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
        },
      );

      assert.notEqual(result.status, 0);
      assert.equal(existsSync(servicePath), false);
      assert.equal(existsSync(passwordPath), false);
    });
  }
});

test("production migration launcher rejects a later complete sentinel after a gap without applying migrations", async (t) => {
  const { root, launcherPath } = await createMigrationRepositoryFixture(t);
  const fixtureDirectory = join(root, "bin");
  const tracePath = join(root, "trace.log");
  const databaseUrl =
    "postgresql://fixture-user:do-not-print-this-database-url@db.example.test/postgres";
  await mkdir(fixtureDirectory, { recursive: true });
  await writeExecutable(
    join(fixtureDirectory, "security"),
    "#!/bin/sh\nprintf 'security %s\\n' \"$5\" >> \"$FAKE_TRACE\"\nprintf '%s' \"$FAKE_DATABASE_URL\"\n",
  );
  await writeExecutable(
    join(fixtureDirectory, "psql"),
    "#!/bin/sh\nargs=\"$*\"\ncase \"$args\" in *' -v ON_ERROR_STOP=1 '*) ;; *) exit 67;; esac\ncase \"$args\" in *' -f '*) printf 'apply unexpectedly\\n' >> \"$FAKE_TRACE\"; exit 88;; esac\nid=$(printf '%s\\n' \"$args\" | sed -n 's/.*vsee-sentinel: \\(00[0-9][0-9]\\).*/\\1/p')\nprintf 'query %s\\n' \"$id\" >> \"$FAKE_TRACE\"\nif [ \"$id\" = \"0009\" ] || [ \"$id\" = \"0010\" ] || [ \"$id\" = \"0012\" ]; then printf 't\\n'; else printf 'f\\n'; fi\n",
  );

  const result = await runCommand("zsh", [launcherPath], {
    ...process.env,
    PATH: `${fixtureDirectory}:${process.env.PATH ?? ""}`,
    FAKE_TRACE: tracePath,
    FAKE_DATABASE_URL: databaseUrl,
    USER: "fixture-user",
  });

  assert.notEqual(result.exitCode, 0);
  assert.match(result.output, /gap/i);
  assert.doesNotMatch(result.output, new RegExp(databaseUrl));
  assert.doesNotMatch(await readFile(tracePath, "utf8"), /apply unexpectedly/);
});

test("production migration launcher stops before a later file when an applied migration remains incomplete", async (t) => {
  const { root, launcherPath } = await createMigrationRepositoryFixture(t);
  const fixtureDirectory = join(root, "bin");
  const tracePath = join(root, "trace.log");
  await mkdir(fixtureDirectory, { recursive: true });
  await writeExecutable(
    join(fixtureDirectory, "security"),
    "#!/bin/sh\nprintf '%s' 'postgresql://fixture-user:fixture-password@db.example.test/postgres'\n",
  );
  await writeExecutable(
    join(fixtureDirectory, "psql"),
    "#!/bin/sh\nargs=\"$*\"\ncase \"$args\" in *' -v ON_ERROR_STOP=1 '*) ;; *) exit 67;; esac\ncase \"$args\" in *' -f '*) file=\"\"; previous=\"\"; for argument in \"$@\"; do if [ \"$previous\" = \"-f\" ]; then file=\"$argument\"; break; fi; previous=\"$argument\"; done; id=$(basename \"$file\" | cut -c1-4); printf 'apply %s\\n' \"$id\" >> \"$FAKE_TRACE\"; exit 0;; esac\nid=$(printf '%s\\n' \"$args\" | sed -n 's/.*vsee-sentinel: \\(00[0-9][0-9]\\).*/\\1/p')\nprintf 'query %s\\n' \"$id\" >> \"$FAKE_TRACE\"\nif [ \"$id\" = \"0009\" ] || [ \"$id\" = \"0010\" ] || [ \"$id\" = \"0011\" ]; then printf 't\\n'; else printf 'f\\n'; fi\n",
  );

  const result = await runCommand("zsh", [launcherPath], {
    ...process.env,
    PATH: `${fixtureDirectory}:${process.env.PATH ?? ""}`,
    FAKE_TRACE: tracePath,
    USER: "fixture-user",
  });

  assert.notEqual(result.exitCode, 0);
  assert.match(result.output, /0012 did not satisfy its sentinel/i);
  const trace = await readFile(tracePath, "utf8");
  assert.match(trace, /apply 0012/);
  assert.doesNotMatch(trace, /apply 0013/);
});

test("production migration launcher aborts before every apply when a sentinel query is not an exact boolean result", async (t) => {
  for (const scenario of ["failure", "empty", "whitespace", "noise"] as const) {
    await t.test(scenario, async (subtest) => {
      const { root, launcherPath } = await createMigrationRepositoryFixture(subtest);
      const fixtureDirectory = join(root, "bin");
      const tracePath = join(root, "trace.log");
      const databaseUrl =
        "postgresql://fixture-user:do-not-print-this-database-url@db.example.test/postgres";
      await mkdir(fixtureDirectory, { recursive: true });
      await writeExecutable(
        join(fixtureDirectory, "security"),
        "#!/bin/sh\nprintf '%s' \"$FAKE_DATABASE_URL\"\n",
      );
      await writeExecutable(
        join(fixtureDirectory, "psql"),
        "#!/bin/sh\nargs=\"$*\"\ncase \"$args\" in *' -v ON_ERROR_STOP=1 '*) ;; *) exit 67;; esac\ncase \"$args\" in *' -f '*) printf 'apply %s\\n' \"$*\" >> \"$FAKE_TRACE\"; exit 88;; esac\nid=$(printf '%s\\n' \"$args\" | sed -n 's/.*vsee-sentinel: \\(00[0-9][0-9]\\).*/\\1/p')\nprintf 'query %s\\n' \"$id\" >> \"$FAKE_TRACE\"\nif [ \"$id\" = \"0011\" ]; then\n  case \"$FAKE_BAD_RESPONSE\" in\n    failure) exit 76 ;;\n    empty) exit 0 ;;\n    whitespace) printf ' t ' ;;\n    noise) printf 't\\nnoise' ;;\n  esac\nfi\nif [ \"$id\" = \"0009\" ] || [ \"$id\" = \"0010\" ]; then printf 't\\n'; else printf 'f\\n'; fi\n",
      );

      const result = await runCommand("zsh", [launcherPath], {
        ...process.env,
        PATH: `${fixtureDirectory}:${process.env.PATH ?? ""}`,
        FAKE_TRACE: tracePath,
        FAKE_DATABASE_URL: databaseUrl,
        FAKE_BAD_RESPONSE: scenario,
        USER: "fixture-user",
      });

      assert.notEqual(result.exitCode, 0);
      assert.match(result.output, /could not verify migration sentinel: 0011/i);
      assert.doesNotMatch(result.output, new RegExp(databaseUrl));
      assert.doesNotMatch(await readFile(tracePath, "utf8"), /^apply /m);
    });
  }
});

test("production migration launcher scopes the 0015 framework catalog sentinel to candidate checkpoints", async (t) => {
  const { root, launcherPath } = await createMigrationRepositoryFixture(t);
  const fixtureDirectory = join(root, "bin");
  const queryPath = join(root, "0015-query.sql");
  await mkdir(fixtureDirectory, { recursive: true });
  await writeExecutable(
    join(fixtureDirectory, "security"),
    "#!/bin/sh\nprintf '%s' 'postgresql://fixture-user:fixture-password@db.example.test/postgres'\n",
  );
  await writeExecutable(
    join(fixtureDirectory, "psql"),
    "#!/bin/sh\nargs=\"$*\"\ncase \"$args\" in *' -v ON_ERROR_STOP=1 '*) ;; *) exit 67;; esac\ncase \"$args\" in *' -f '*) exit 88;; esac\nid=$(printf '%s\\n' \"$args\" | sed -n 's/.*vsee-sentinel: \\(00[0-9][0-9]\\).*/\\1/p')\nif [ \"$id\" = \"0015\" ]; then printf '%s' \"$args\" > \"$FAKE_0015_QUERY\"; fi\nprintf 't\\n'\n",
  );

  const result = await runCommand("zsh", [launcherPath], {
    ...process.env,
    PATH: `${fixtureDirectory}:${process.env.PATH ?? ""}`,
    FAKE_0015_QUERY: queryPath,
    USER: "fixture-user",
  });

  assert.equal(result.exitCode, 0);
  assert.match(
    await readFile(queryPath, "utf8"),
    /conrelid\s*=\s*to_regclass\('public\.candidate_checkpoints'\)/i,
  );
});
