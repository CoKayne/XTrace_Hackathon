import { execFileSync } from "node:child_process";

interface AssetDirectoryOptions {
  explicitVersion?: string;
  readGitRevision?: () => string;
}

function readCurrentGitRevision(): string {
  return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
}

function normalizeVersion(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function resolveAssetDirectory(
  options: AssetDirectoryOptions = {},
): string {
  const explicitVersion = normalizeVersion(options.explicitVersion ?? "");
  if (explicitVersion) return `assets-${explicitVersion}`;

  try {
    const gitRevision = normalizeVersion(
      (options.readGitRevision ?? readCurrentGitRevision)(),
    );
    if (gitRevision) return `assets-${gitRevision}`;
  } catch {
    // Source archives outside a Git checkout still need one stable local path.
  }

  return "assets-local";
}
