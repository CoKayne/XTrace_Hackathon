import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { DEMO_DEAL_EVIDENCE } from "../lib/corpus/evidence";
import { DEMO_FIXTURES } from "../lib/corpus/fixtures";
import {
  listDocumentDeals,
  listPreloadedDocuments,
} from "../lib/corpus/manifest";
import {
  companyIdForDeal,
  createDefaultDemoDataStore,
  createDefaultPrivateObjectStorage,
  privateObjectKey,
  type DemoDataStore,
  type PrivateObjectStorage,
} from "../lib/storage/service";

const DEMO_WORKSPACE = {
  id: "workspace_demo",
  name: "XTrace VC Demo",
} as const;
const DEMO_USER = {
  id: "user_demo",
  email: "demo@xtrace.local",
  displayName: "XTrace Demo Investor",
} as const;

export interface DemoSeedDependencies {
  dataStore: DemoDataStore;
  objectStorage: PrivateObjectStorage;
  corpusDirectory: string;
}

export interface DemoSeedResult {
  reset: boolean;
  created: {
    workspaces: number;
    users: number;
    memberships: number;
    documents: number;
    workspaceDocuments: number;
    privateObjects: number;
    companies: number;
    deals: number;
    evidence: number;
    fixtures: number;
  };
}

export async function runDemoSeed(
  dependencies: DemoSeedDependencies,
  options: { reset?: boolean } = {},
): Promise<DemoSeedResult> {
  if (options.reset) {
    await dependencies.dataStore.resetDemoData({ includeHistory: true });
  }

  const created = emptyCreatedCounts();
  increment(created, "workspaces", await dependencies.dataStore.ensureWorkspace(DEMO_WORKSPACE));
  increment(created, "users", await dependencies.dataStore.ensureUser(DEMO_USER));
  increment(created, "memberships", await dependencies.dataStore.ensureMembership({
    workspaceId: DEMO_WORKSPACE.id,
    userId: DEMO_USER.id,
    role: "owner",
  }));

  for (const document of listPreloadedDocuments()) {
    const bytes = new Uint8Array(await readFile(path.join(dependencies.corpusDirectory, document.filename)));
    verifyDocumentBytes(document.filename, document.byteSize, document.checksum, bytes);
    const objectKey = privateObjectKey(document);
    increment(created, "privateObjects", await dependencies.objectStorage.ensurePrivateObject({
      key: objectKey,
      bytes,
      contentType: "application/pdf",
    }));
    increment(created, "documents", await dependencies.dataStore.ensureDocument({
      ...document,
      objectKey,
    }));

    if (document.role === "reference") continue;

    if (document.role === "market_report") continue;

    for (const deal of listDocumentDeals(document)) {
      const companyId = companyIdForDeal(deal.dealId);
      increment(created, "companies", await dependencies.dataStore.ensureCompany({
        id: companyId,
        workspaceId: DEMO_WORKSPACE.id,
        name: deal.company,
      }));
      increment(created, "deals", await dependencies.dataStore.ensureDeal({
        id: deal.dealId,
        workspaceId: DEMO_WORKSPACE.id,
        companyId,
        companyName: deal.company,
      }));
    }
  }

  for (const evidence of DEMO_DEAL_EVIDENCE) {
    increment(created, "evidence", await dependencies.dataStore.ensureEvidence({
      workspaceId: DEMO_WORKSPACE.id,
      ...evidence,
    }));
  }
  for (const fixture of DEMO_FIXTURES) {
    increment(created, "fixtures", await dependencies.dataStore.ensureFixture({
      workspaceId: DEMO_WORKSPACE.id,
      ...fixture,
    }));
  }

  return { reset: Boolean(options.reset), created };
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  for (const argument of args) {
    if (argument !== "--reset") {
      throw new Error(`Unknown seed argument: ${argument}`);
    }
  }
  const result = await runDemoSeed({
    dataStore: createDefaultDemoDataStore(),
    objectStorage: createDefaultPrivateObjectStorage(),
    corpusDirectory: path.join(process.cwd(), "seed", "corpus"),
  }, { reset: args.has("--reset") });
  console.log(JSON.stringify(result));
}

function emptyCreatedCounts(): DemoSeedResult["created"] {
  return {
    workspaces: 0,
    users: 0,
    memberships: 0,
    documents: 0,
    workspaceDocuments: 0,
    privateObjects: 0,
    companies: 0,
    deals: 0,
    evidence: 0,
    fixtures: 0,
  };
}

function increment(
  counts: DemoSeedResult["created"],
  key: keyof DemoSeedResult["created"],
  result: { created: boolean },
): void {
  if (result.created) counts[key] += 1;
}

function verifyDocumentBytes(
  filename: string,
  expectedSize: number,
  expectedChecksum: string,
  bytes: Uint8Array,
): void {
  if (bytes.byteLength !== expectedSize) {
    throw new Error(`Corpus file ${filename} has byte size ${bytes.byteLength}; expected ${expectedSize}.`);
  }
  const checksum = createHash("sha256").update(bytes).digest("hex");
  if (checksum !== expectedChecksum) {
    throw new Error(`Corpus file ${filename} checksum ${checksum} does not match the manifest.`);
  }
}

const directEntry = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";
if (import.meta.url === directEntry) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
