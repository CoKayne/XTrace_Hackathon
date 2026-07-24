import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";

const freshSchemaPath = fileURLToPath(
  new URL("../../drizzle/0000_vsee_postgres.sql", import.meta.url),
);
const removeDeliveryPath = fileURLToPath(
  new URL("../../drizzle/0001_remove_report_delivery.sql", import.meta.url),
);
const durabilityMigrationPath = fileURLToPath(
  new URL("../../drizzle/0002_durable_decision_lineage.sql", import.meta.url),
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

function withTemporaryDatabase(run: (database: string) => void): void {
  const database = `vsee_migration_${process.pid}_${randomUUID().replaceAll("-", "")}`;
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

test(
  "fresh PostgreSQL schema requires durable decision and XTrace reuse metadata",
  { skip: !canCreateTemporaryDatabase },
  () => {
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
  "forward migration backfills legacy rows without treating synthetic rationale as a source fact",
  { skip: !canCreateTemporaryDatabase },
  () => {
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
