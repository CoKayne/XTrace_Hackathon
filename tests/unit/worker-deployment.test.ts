import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const dockerfilePath = new URL("../../Dockerfile.worker", import.meta.url);
const packagePath = new URL("../../package.json", import.meta.url);
const readmePath = new URL("../../README.md", import.meta.url);
const repositoryRootPath = new URL("../../", import.meta.url).pathname;
const workerLauncherPath = new URL(
  "../../scripts/run-worker-from-keychain.zsh",
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

test("worker image has a non-root long-running command and health check", async () => {
  const dockerfile = await readFile(dockerfilePath, "utf8");

  assert.match(dockerfile, /^FROM node:22[\w.-]*-bookworm-slim/m);
  assert.match(dockerfile, /^USER node$/m);
  assert.match(dockerfile, /^HEALTHCHECK\b/m);
  assert.match(dockerfile, /npm",\s*"run",\s*"worker:health"/);
  assert.match(dockerfile, /^CMD \["npm",\s*"run",\s*"worker"\]$/m);
});

test("worker build context includes every seed and research runtime import", async () => {
  const dockerfile = await readFile(dockerfilePath, "utf8");

  assert.match(
    dockerfile,
    /^COPY --chown=node:node seed\/underwriting \.\/seed\/underwriting$/m,
  );
  assert.match(
    dockerfile,
    /^COPY --chown=node:node research\/framework-authoring \.\/research\/framework-authoring$/m,
  );
});

test("worker scripts and production runbook stay documented", async () => {
  const [packageText, readme] = await Promise.all([
    readFile(packagePath, "utf8"),
    readFile(readmePath, "utf8"),
  ]);
  const packageJson = JSON.parse(packageText) as {
    scripts?: Record<string, string>;
  };

  assert.equal(packageJson.scripts?.worker, "tsx worker/runner.ts");
  assert.equal(
    packageJson.scripts?.["worker:health"],
    "node --import tsx worker/health.ts",
  );
  assert.match(readme, /docker build -f Dockerfile\.worker/i);
  assert.match(readme, /fail(?:s)? closed/i);
  assert.match(readme, /worker:health/i);
});

test("keychain worker launcher starts the worker with public-sandbox settings without exposing secrets", async (t) => {
  const fixtureDirectory = await mkdtemp(join(tmpdir(), "vsee-worker-launcher-"));
  const runtimeDirectory = join(repositoryRootPath, ".runtime");
  const tracePath = join(fixtureDirectory, "trace.log");
  const secretValue = "worker-secret-must-not-be-printed";
  t.after(async () => {
    await rm(fixtureDirectory, { recursive: true, force: true });
    await rm(runtimeDirectory, { recursive: true, force: true });
  });
  await writeExecutable(
    join(fixtureDirectory, "security"),
    "#!/bin/sh\nprintf 'security %s\\n' \"$5\" >> \"$FAKE_TRACE\"\nprintf '%s' \"$FAKE_SECRET\"\n",
  );
  await writeExecutable(
    join(fixtureDirectory, "npm"),
    "#!/bin/sh\nprintf 'npm %s %s mode=%s workspace=%s\\n' \"$1\" \"$2\" \"$VSEE_DEPLOYMENT_MODE\" \"$DEMO_WORKSPACE_ID\" >> \"$FAKE_TRACE\"\n",
  );

  const result = await runCommand("zsh", [workerLauncherPath], {
    ...process.env,
    PATH: `${fixtureDirectory}:${process.env.PATH ?? ""}`,
    FAKE_TRACE: tracePath,
    FAKE_SECRET: secretValue,
    USER: "fixture-user",
  });

  assert.equal(result.exitCode, 0);
  assert.doesNotMatch(result.output, new RegExp(secretValue));
  assert.doesNotMatch(await readFile(tracePath, "utf8"), new RegExp(secretValue));
  assert.equal(
    await readFile(tracePath, "utf8"),
    [
      "security vsee-supabase-url",
      "security vsee-supabase-service-role-key",
      "security vsee-anthropic-api-key",
      "security vsee-xtrace-api-key",
      "security vsee-document-url-signing-secret",
      "npm run worker mode=public_sandbox workspace=workspace_demo",
      "",
    ].join("\n"),
  );
  assert.match(
    await readFile(join(runtimeDirectory, "worker.log"), "utf8"),
    /^$/,
  );
});

test("keychain worker launcher fails closed before npm when a required secret is missing", async (t) => {
  const fixtureDirectory = await mkdtemp(join(tmpdir(), "vsee-worker-missing-secret-"));
  const runtimeDirectory = join(repositoryRootPath, ".runtime");
  const tracePath = join(fixtureDirectory, "trace.log");
  t.after(async () => {
    await rm(fixtureDirectory, { recursive: true, force: true });
    await rm(runtimeDirectory, { recursive: true, force: true });
  });
  await writeExecutable(
    join(fixtureDirectory, "security"),
    "#!/bin/sh\nprintf 'security %s\\n' \"$5\" >> \"$FAKE_TRACE\"\nif [ \"$5\" = \"vsee-xtrace-api-key\" ]; then exit 44; fi\nprintf '%s' 'available-secret'\n",
  );
  await writeExecutable(
    join(fixtureDirectory, "npm"),
    "#!/bin/sh\nprintf 'npm started\\n' >> \"$FAKE_TRACE\"\n",
  );

  const result = await runCommand("zsh", [workerLauncherPath], {
    ...process.env,
    PATH: `${fixtureDirectory}:${process.env.PATH ?? ""}`,
    FAKE_TRACE: tracePath,
    USER: "fixture-user",
  });

  assert.notEqual(result.exitCode, 0);
  assert.match(result.output, /vsee-xtrace-api-key/);
  assert.equal(
    await readFile(tracePath, "utf8"),
    [
      "security vsee-supabase-url",
      "security vsee-supabase-service-role-key",
      "security vsee-anthropic-api-key",
      "security vsee-xtrace-api-key",
      "",
    ].join("\n"),
  );
});
