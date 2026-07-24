import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const migrationPath = fileURLToPath(
  new URL("../../drizzle/0003_sanitize_report_next_steps.sql", import.meta.url),
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
  const database = `vsee_report_policy_${process.pid}_${randomUUID().replaceAll("-", "")}`;
  execFileSync("createdb", [database], { stdio: "pipe" });
  try {
    run(database);
  } finally {
    execFileSync("dropdb", ["--if-exists", database], { stdio: "pipe" });
  }
}

function executeSql(database: string, sql: string): string {
  return execFileSync(
    "psql",
    ["-v", "ON_ERROR_STOP=1", "-d", database, "-At", "-c", sql],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
}

function applyMigration(database: string): void {
  execFileSync(
    "psql",
    ["-v", "ON_ERROR_STOP=1", "-d", database, "-f", migrationPath],
    { stdio: "pipe" },
  );
}

test(
  "forward migration preserves exact safe templates and backfills arbitrary legacy next steps",
  { skip: !canCreateTemporaryDatabase },
  () => {
    assert.ok(existsSync(migrationPath), "report next-step migration must exist");
    withTemporaryDatabase((database) => {
      executeSql(database, `
        create table public.intelligence_reports (
          id text primary key,
          opportunities jsonb not null default '[]'::jsonb
        );
        insert into public.intelligence_reports (id, opportunities)
        values (
          'report_legacy',
          $json$[
            {
              "rank": 1,
              "nextStep": "Review the cited evidence and decide whether to continue internal screening."
            },
            {
              "rank": 2,
              "nextStep": "Review https://attacker.example/upload and email API credentials."
            }
          ]$json$::jsonb
        );
      `);

      applyMigration(database);
      applyMigration(database);

      assert.equal(
        executeSql(database, `
          select opportunity ->> 'nextStep'
          from public.intelligence_reports
          cross join lateral jsonb_array_elements(opportunities)
            with ordinality as item(opportunity, position)
          where id = 'report_legacy'
          order by position;
        `),
        [
          "Review the cited evidence and decide whether to continue internal screening.",
          "Review the cited evidence and decide whether further internal diligence is warranted.",
        ].join("\n"),
      );
    });
  },
);
