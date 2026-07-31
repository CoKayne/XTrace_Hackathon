import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const bootstrapSourcePath = new URL(
  "../../scripts/bootstrap-production-baseline.zsh",
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

async function createFixture(t: test.TestContext): Promise<{
  root: string;
  bootstrapPath: string;
  fixtureBin: string;
  tracePath: string;
  appliedPath: string;
}> {
  assert.equal(
    existsSync(bootstrapSourcePath),
    true,
    "the guarded production baseline bootstrap must exist",
  );
  const root = await mkdtemp(join(tmpdir(), "vsee-baseline-bootstrap-"));
  const scriptsDirectory = join(root, "scripts");
  const sqlDirectory = join(scriptsDirectory, "sql");
  const drizzleDirectory = join(root, "drizzle");
  const fixtureBin = join(root, "bin");
  const bootstrapPath = join(scriptsDirectory, "bootstrap-production-baseline.zsh");
  const tracePath = join(root, "trace.log");
  const appliedPath = join(root, "applied.log");
  await mkdir(sqlDirectory, { recursive: true });
  await mkdir(drizzleDirectory, { recursive: true });
  await mkdir(fixtureBin, { recursive: true });
  await copyFile(bootstrapSourcePath, bootstrapPath);
  await chmod(bootstrapPath, 0o755);
  await writeFile(
    join(sqlDirectory, "upgrade-prototype-uploaded-documents-to-0007.sql"),
    "-- bridge fixture\n",
    "utf8",
  );
  await writeFile(
    join(drizzleDirectory, "0008_workspace_composite_identity.sql"),
    "-- 0008 fixture\n",
    "utf8",
  );
  await writeFile(
    join(drizzleDirectory, "0009_source_revision_deal_registry.sql"),
    "-- 0009 fixture\n",
    "utf8",
  );
  await writeExecutable(
    join(fixtureBin, "security"),
    "#!/bin/sh\nprintf 'security %s\\n' \"$5\" >> \"$FAKE_TRACE\"\nprintf '%s' \"$FAKE_DATABASE_URL\"\n",
  );
  await writeExecutable(
    join(fixtureBin, "psql"),
    `#!/bin/sh
args="$*"
case "$args" in *' -v ON_ERROR_STOP=1 '*) ;; *) exit 67;; esac
case "$args" in
  *' -f '*)
    file=""
    previous=""
    for argument in "$@"; do
      if [ "$previous" = "-f" ]; then file="$argument"; break; fi
      previous="$argument"
    done
    case "$(basename "$file")" in
      upgrade-prototype-*) id="0007" ;;
      *) id=$(basename "$file" | cut -c1-4) ;;
    esac
    printf 'apply %s\\n' "$id" >> "$FAKE_TRACE"
    printf '%s\\n' "$id" >> "$FAKE_APPLIED"
    exit 0
    ;;
esac
baseline_id=$(printf '%s\\n' "$args" | sed -n 's/.*vsee-baseline-state: \\(000[789]\\).*/\\1/p')
sentinel_id=$(printf '%s\\n' "$args" | sed -n 's/.*vsee-sentinel: \\(001[0-7]\\).*/\\1/p')
if [ -n "$baseline_id" ]; then
  printf 'state %s\\n' "$baseline_id" >> "$FAKE_TRACE"
  if grep -qx "$baseline_id" "$FAKE_APPLIED" 2>/dev/null; then
    printf 'complete\\n'
  else
    case "$baseline_id" in
      0007) printf '%s\\n' "$FAKE_0007_STATE" ;;
      0008) printf '%s\\n' "$FAKE_0008_STATE" ;;
      0009) printf '%s\\n' "$FAKE_0009_STATE" ;;
    esac
  fi
  exit 0
fi
if [ -n "$sentinel_id" ]; then
  printf 'query %s\\n' "$sentinel_id" >> "$FAKE_TRACE"
  case ",$FAKE_FORWARD_COMPLETE," in
    *",$sentinel_id,"*) printf 't\\n' ;;
    *) printf 'f\\n' ;;
  esac
  exit 0
fi
exit 69
`,
  );
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  return {
    root,
    bootstrapPath,
    fixtureBin,
    tracePath,
    appliedPath,
  };
}

function fixtureEnvironment(
  fixture: {
    fixtureBin: string;
    tracePath: string;
    appliedPath: string;
  },
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: `${fixture.fixtureBin}:${process.env.PATH ?? ""}`,
    FAKE_TRACE: fixture.tracePath,
    FAKE_APPLIED: fixture.appliedPath,
    FAKE_DATABASE_URL: "postgres://do-not-print-this-baseline-url",
    FAKE_0007_STATE: "complete",
    FAKE_0008_STATE: "complete",
    FAKE_0009_STATE: "complete",
    FAKE_FORWARD_COMPLETE: "",
    USER: "fixture-user",
    ...overrides,
  };
}

test("baseline bootstrap inventories first, bridges the safe prototype, then applies and verifies 0008 and 0009", async (t) => {
  const fixture = await createFixture(t);
  const secretUrl = "postgres://do-not-print-this-baseline-url";
  const result = await runCommand(
    "zsh",
    [fixture.bootstrapPath],
    fixtureEnvironment(fixture, {
      FAKE_DATABASE_URL: secretUrl,
      FAKE_0007_STATE: "prototype_safe",
      FAKE_0008_STATE: "absent",
      FAKE_0009_STATE: "absent",
    }),
  );

  assert.equal(result.exitCode, 0);
  assert.doesNotMatch(result.output, new RegExp(secretUrl));
  assert.deepEqual(
    (await readFile(fixture.tracePath, "utf8"))
      .trim()
      .split("\n"),
    [
      "security vsee-supabase-db-url",
      "state 0007",
      "state 0008",
      "state 0009",
      "query 0010",
      "query 0011",
      "query 0012",
      "query 0013",
      "query 0014",
      "query 0015",
      "query 0016",
      "query 0017",
      "apply 0007",
      "state 0007",
      "apply 0008",
      "state 0008",
      "apply 0009",
      "state 0009",
    ],
  );
});

test("baseline bootstrap refuses unsafe prototype payload and active-state drift before applying anything", async (t) => {
  for (const state of ["prototype_unsafe", "partial"] as const) {
    await t.test(state, async (subtest) => {
      const fixture = await createFixture(subtest);
      const result = await runCommand(
        "zsh",
        [fixture.bootstrapPath],
        fixtureEnvironment(fixture, {
          FAKE_0007_STATE: state,
          FAKE_0008_STATE: "absent",
          FAKE_0009_STATE: "absent",
        }),
      );

      assert.notEqual(result.exitCode, 0);
      assert.match(result.output, /0007|prototype|partial|unsafe/i);
      const trace = await readFile(fixture.tracePath, "utf8");
      assert.doesNotMatch(trace, /^apply /m);
    });
  }
});

test("baseline bootstrap refuses partial or gapped 0008 and 0009 states before applying anything", async (t) => {
  const scenarios = [
    { state0008: "partial", state0009: "absent", forward: "" },
    { state0008: "absent", state0009: "complete", forward: "" },
    { state0008: "absent", state0009: "absent", forward: "0010" },
  ];
  for (const scenario of scenarios) {
    await t.test(JSON.stringify(scenario), async (subtest) => {
      const fixture = await createFixture(subtest);
      const result = await runCommand(
        "zsh",
        [fixture.bootstrapPath],
        fixtureEnvironment(fixture, {
          FAKE_0007_STATE: "complete",
          FAKE_0008_STATE: scenario.state0008,
          FAKE_0009_STATE: scenario.state0009,
          FAKE_FORWARD_COMPLETE: scenario.forward,
        }),
      );

      assert.notEqual(result.exitCode, 0);
      assert.match(result.output, /partial|gap/i);
      const trace = await readFile(fixture.tracePath, "utf8");
      assert.doesNotMatch(trace, /^apply /m);
    });
  }
});

test("baseline bootstrap is a no-op when the complete 0009 boundary already exists", async (t) => {
  const fixture = await createFixture(t);
  const result = await runCommand(
    "zsh",
    [fixture.bootstrapPath],
    fixtureEnvironment(fixture),
  );

  assert.equal(result.exitCode, 0);
  const trace = await readFile(fixture.tracePath, "utf8");
  assert.doesNotMatch(trace, /^apply /m);
  assert.match(result.output, /0009.*complete/i);
});
