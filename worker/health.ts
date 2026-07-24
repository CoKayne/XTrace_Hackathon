import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_WORKER_HEALTH_FILE = "/tmp/vsee-worker-health";
export const DEFAULT_WORKER_HEALTH_MAX_AGE_MS = 60_000;

interface WorkerHealthOptions {
  now?: Date;
  maxAgeMs?: number;
}

export function workerHealthFilePath(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  return environment.WORKER_HEALTH_FILE?.trim()
    || DEFAULT_WORKER_HEALTH_FILE;
}

export function workerHealthMaxAgeMs(
  environment: NodeJS.ProcessEnv = process.env,
): number {
  const configured = Number(environment.WORKER_HEALTH_MAX_AGE_MS);
  return Number.isInteger(configured) && configured > 0
    ? configured
    : DEFAULT_WORKER_HEALTH_MAX_AGE_MS;
}

export async function writeWorkerHealthMarker(
  path: string,
  now = new Date(),
): Promise<void> {
  if (!Number.isFinite(now.getTime())) {
    throw new TypeError("Worker health marker requires a valid timestamp.");
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${now.toISOString()}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

export async function checkWorkerHealth(
  path: string,
  options: WorkerHealthOptions = {},
): Promise<boolean> {
  const now = options.now ?? new Date();
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_WORKER_HEALTH_MAX_AGE_MS;
  if (
    !Number.isFinite(now.getTime())
    || !Number.isInteger(maxAgeMs)
    || maxAgeMs <= 0
  ) {
    return false;
  }

  try {
    const markedAt = Date.parse((await readFile(path, "utf8")).trim());
    if (!Number.isFinite(markedAt)) return false;
    const age = now.getTime() - markedAt;
    return age >= 0 && age <= maxAgeMs;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const path = workerHealthFilePath();
  const healthy = await checkWorkerHealth(path, {
    maxAgeMs: workerHealthMaxAgeMs(),
  });
  if (!healthy) {
    console.error(`Worker health marker is missing or stale: ${path}`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : "";
if (import.meta.url === invokedPath) {
  void main();
}
