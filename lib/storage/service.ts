import { readFile } from "node:fs/promises";
import path from "node:path";

import type { DemoDealEvidence } from "../corpus/evidence";
import type { DemoFixture } from "../corpus/fixtures";
import {
  getPreloadedDeal,
  listPreloadedDocuments,
  type PreloadedDocument,
} from "../corpus/manifest";
import type { CorpusPersistence } from "../corpus/service";

export interface UpsertResult<T> {
  value: T;
  created: boolean;
}

export interface DemoWorkspaceRecord {
  id: string;
  name: string;
}

export interface DemoUserRecord {
  id: string;
  email: string;
  displayName: string;
}

export interface DemoMembershipRecord {
  workspaceId: string;
  userId: string;
  role: "owner";
}

export interface StoredCorpusDocument extends PreloadedDocument {
  objectKey: string;
}

export interface WorkspaceDocumentRecord {
  workspaceId: string;
  documentId: string;
}

export interface DemoCompanyRecord {
  id: string;
  workspaceId: string;
  name: string;
}

export interface DemoDealRecord {
  id: string;
  workspaceId: string;
  companyId: string;
  companyName: string;
}

export interface StoredEvidenceRecord extends DemoDealEvidence {
  workspaceId: string;
}

export interface StoredFixtureRecord extends DemoFixture {
  workspaceId: string;
}

export interface DemoDataStore {
  ensureWorkspace(input: DemoWorkspaceRecord): Promise<UpsertResult<DemoWorkspaceRecord>>;
  ensureUser(input: DemoUserRecord): Promise<UpsertResult<DemoUserRecord>>;
  ensureMembership(input: DemoMembershipRecord): Promise<UpsertResult<DemoMembershipRecord>>;
  ensureDocument(input: StoredCorpusDocument): Promise<UpsertResult<StoredCorpusDocument>>;
  ensureWorkspaceDocument(input: WorkspaceDocumentRecord): Promise<UpsertResult<WorkspaceDocumentRecord>>;
  listWorkspaceDocumentIds(workspaceId: string): Promise<string[]>;
  ensureCompany(input: DemoCompanyRecord): Promise<UpsertResult<DemoCompanyRecord>>;
  ensureDeal(input: DemoDealRecord): Promise<UpsertResult<DemoDealRecord>>;
  ensureEvidence(input: StoredEvidenceRecord): Promise<UpsertResult<StoredEvidenceRecord>>;
  ensureFixture(input: StoredFixtureRecord): Promise<UpsertResult<StoredFixtureRecord>>;
  resetDemoData(options?: { includeHistory?: boolean }): Promise<void>;
}

export interface DemoDataSnapshot {
  workspaces: DemoWorkspaceRecord[];
  users: DemoUserRecord[];
  memberships: DemoMembershipRecord[];
  documents: StoredCorpusDocument[];
  workspaceDocuments: WorkspaceDocumentRecord[];
  companies: DemoCompanyRecord[];
  deals: DemoDealRecord[];
  evidence: StoredEvidenceRecord[];
  fixtures: StoredFixtureRecord[];
}

export interface MemoryDemoDataStore extends DemoDataStore {
  inspect(): DemoDataSnapshot;
}

export interface PrivateObjectInput {
  key: string;
  bytes: Uint8Array;
  contentType: "application/pdf";
}

export interface PrivateObjectStorage {
  ensurePrivateObject(input: PrivateObjectInput): Promise<UpsertResult<{ key: string }>>;
  readPrivateObject(key: string): Promise<Uint8Array | null>;
}

export interface MemoryPrivateObjectStorage extends PrivateObjectStorage {
  inspect(): Array<{ key: string; byteSize: number; contentType: string }>;
}

export interface PrivateDocumentAccess {
  createPrivateReadUrl(input: { documentId: string; expiresInSeconds: number }): Promise<string>;
  authorizePrivateRead(request: Request): Promise<string>;
}

const MAX_PRIVATE_READ_TTL_SECONDS = 10 * 60;
const DEFAULT_STORAGE_BUCKET = "vsee-demo-sources";
const DEFAULT_ROUTE_PREFIX = "/api/documents";
const DEVELOPMENT_SIGNING_SECRET = "xtrace-development-document-read-secret";

export function createMemoryDemoDataStore(): MemoryDemoDataStore {
  const workspaces = new Map<string, DemoWorkspaceRecord>();
  const users = new Map<string, DemoUserRecord>();
  const memberships = new Map<string, DemoMembershipRecord>();
  const documents = new Map<string, StoredCorpusDocument>();
  const workspaceDocuments = new Map<string, WorkspaceDocumentRecord>();
  const companies = new Map<string, DemoCompanyRecord>();
  const deals = new Map<string, DemoDealRecord>();
  const evidence = new Map<string, StoredEvidenceRecord>();
  const fixtures = new Map<string, StoredFixtureRecord>();

  return {
    ensureWorkspace: (input) => ensureMemory(workspaces, input.id, input),
    ensureUser: (input) => ensureMemory(users, input.id, input),
    ensureMembership: (input) => ensureMemory(
      memberships,
      `${input.workspaceId}:${input.userId}`,
      input,
    ),
    ensureDocument: async (input) => {
      const existing = documents.get(input.checksum);
      if (existing && existing.id !== input.id) {
        throw new Error(`Corpus checksum ${input.checksum} is already assigned to ${existing.id}.`);
      }
      return ensureMemory(documents, input.checksum, input);
    },
    ensureWorkspaceDocument: (input) => ensureMemory(
      workspaceDocuments,
      `${input.workspaceId}:${input.documentId}`,
      input,
    ),
    async listWorkspaceDocumentIds(workspaceId) {
      return [...workspaceDocuments.values()]
        .filter((record) => record.workspaceId === workspaceId)
        .map((record) => record.documentId)
        .sort();
    },
    ensureCompany: (input) => ensureMemory(companies, input.id, input),
    ensureDeal: (input) => ensureMemory(deals, input.id, input),
    ensureEvidence: (input) => ensureMemory(evidence, input.id, input),
    ensureFixture: (input) => ensureMemory(fixtures, input.id, input),
    async resetDemoData() {
      workspaces.clear();
      users.clear();
      memberships.clear();
      documents.clear();
      workspaceDocuments.clear();
      companies.clear();
      deals.clear();
      evidence.clear();
      fixtures.clear();
    },
    inspect() {
      return {
        workspaces: cloneValues(workspaces),
        users: cloneValues(users),
        memberships: cloneValues(memberships),
        documents: cloneValues(documents),
        workspaceDocuments: cloneValues(workspaceDocuments),
        companies: cloneValues(companies),
        deals: cloneValues(deals),
        evidence: cloneValues(evidence),
        fixtures: cloneValues(fixtures),
      };
    },
  };
}

export function createMemoryPrivateObjectStorage(): MemoryPrivateObjectStorage {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();

  return {
    async ensurePrivateObject(input) {
      const existing = objects.get(input.key);
      if (existing) {
        if (!equalBytes(existing.bytes, input.bytes)) {
          throw new Error(`Private object ${input.key} already exists with different bytes.`);
        }
        return { value: { key: input.key }, created: false };
      }
      objects.set(input.key, {
        bytes: new Uint8Array(input.bytes),
        contentType: input.contentType,
      });
      return { value: { key: input.key }, created: true };
    },
    async readPrivateObject(key) {
      const object = objects.get(key);
      return object ? new Uint8Array(object.bytes) : null;
    },
    inspect() {
      return [...objects.entries()]
        .map(([key, object]) => ({
          key,
          byteSize: object.bytes.byteLength,
          contentType: object.contentType,
        }))
        .sort((left, right) => left.key.localeCompare(right.key));
    },
  };
}

export function createBundledPrivateObjectStorage(options: {
  corpusDirectory?: string;
} = {}): PrivateObjectStorage {
  const corpusDirectory = options.corpusDirectory ?? path.join(process.cwd(), "seed", "corpus");

  return {
    async ensurePrivateObject(input) {
      const document = documentForObjectKey(input.key);
      if (!document) throw new Error(`Unknown private corpus object: ${input.key}`);
      const bytes = new Uint8Array(await readFile(path.join(corpusDirectory, document.filename)));
      if (!equalBytes(bytes, input.bytes)) {
        throw new Error(`Bundled corpus object ${document.filename} does not match its seed bytes.`);
      }
      return { value: { key: input.key }, created: false };
    },
    async readPrivateObject(key) {
      const document = documentForObjectKey(key);
      if (!document) return null;
      try {
        return new Uint8Array(await readFile(path.join(corpusDirectory, document.filename)));
      } catch {
        return null;
      }
    },
  };
}

export function createPrivateDocumentAccess(options: {
  signingSecret: string;
  now?: () => number;
  routePrefix?: string;
}): PrivateDocumentAccess {
  if (options.signingSecret.length < 32) {
    throw new Error("Document URL signing secret must be at least 32 characters.");
  }
  const now = options.now ?? Date.now;
  const routePrefix = normalizeRoutePrefix(options.routePrefix ?? DEFAULT_ROUTE_PREFIX);
  const key = globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(options.signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );

  return {
    async createPrivateReadUrl({ documentId, expiresInSeconds }) {
      if (!documentId.trim()) throw new Error("A document id is required.");
      if (
        !Number.isInteger(expiresInSeconds)
        || expiresInSeconds < 1
        || expiresInSeconds > MAX_PRIVATE_READ_TTL_SECONDS
      ) {
        throw new Error(`Private document URLs may expire in at most ${MAX_PRIVATE_READ_TTL_SECONDS} seconds.`);
      }
      const expires = Math.floor(now() / 1_000) + expiresInSeconds;
      const signature = await signReadCapability(key, documentId, expires);
      const query = new URLSearchParams({ expires: String(expires), signature });
      return `${routePrefix}/${encodeURIComponent(documentId)}?${query}`;
    },
    async authorizePrivateRead(request) {
      const url = new URL(request.url);
      const prefix = `${routePrefix}/`;
      if (!url.pathname.startsWith(prefix)) {
        throw new Error("Invalid private document route.");
      }
      const encodedDocumentId = url.pathname.slice(prefix.length);
      if (!encodedDocumentId || encodedDocumentId.includes("/")) {
        throw new Error("Invalid private document id.");
      }
      const documentId = decodeURIComponent(encodedDocumentId);
      const expiresRaw = url.searchParams.get("expires");
      const signature = url.searchParams.get("signature");
      if (!expiresRaw || !signature || !/^\d+$/.test(expiresRaw)) {
        throw new Error("Private document read capability is missing.");
      }
      const expires = Number(expiresRaw);
      const currentSeconds = Math.floor(now() / 1_000);
      if (expires <= currentSeconds) {
        throw new Error("Private document read capability has expired.");
      }
      if (expires > currentSeconds + MAX_PRIVATE_READ_TTL_SECONDS) {
        throw new Error("Private document read capability exceeds 600 seconds.");
      }
      const valid = await verifyReadCapability(key, documentId, expires, signature);
      if (!valid) {
        throw new Error("Private document read capability is invalid.");
      }
      return documentId;
    },
  };
}

export function createSupabasePrivateObjectStorage(options: {
  url: string;
  serviceRoleKey: string;
  bucket?: string;
  fetchImpl?: typeof fetch;
}): PrivateObjectStorage {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = `${options.url.replace(/\/$/, "")}/storage/v1/object`;
  const bucket = options.bucket ?? DEFAULT_STORAGE_BUCKET;
  const headers = {
    apikey: options.serviceRoleKey,
    authorization: `Bearer ${options.serviceRoleKey}`,
  };

  return {
    async ensurePrivateObject(input) {
      const objectUrl = `${base}/${encodeObjectPath(`${bucket}/${input.key}`)}`;
      const existing = await fetchImpl(objectUrl, {
        headers,
        cache: "no-store",
      });
      if (existing.ok) {
        const existingBytes = new Uint8Array(await existing.arrayBuffer());
        if (!equalBytes(existingBytes, input.bytes)) {
          throw new Error(
            `Private object ${input.key} already exists with different bytes.`,
          );
        }
        return { value: { key: input.key }, created: false };
      }
      if (existing.status !== 404) {
        throw await storageHttpError("check", existing);
      }
      const response = await fetchImpl(objectUrl, {
        method: "POST",
        headers: {
          ...headers,
          "content-type": input.contentType,
          "x-upsert": "false",
        },
        body: toArrayBuffer(input.bytes),
        cache: "no-store",
      });
      if (!response.ok) throw await storageHttpError("upload", response);
      return { value: { key: input.key }, created: true };
    },
    async readPrivateObject(key) {
      const response = await fetchImpl(`${base}/${encodeObjectPath(`${bucket}/${key}`)}`, {
        headers,
        cache: "no-store",
      });
      if (response.status === 404) return null;
      if (!response.ok) throw await storageHttpError("read", response);
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}

export function createSupabaseDemoDataStore(options: {
  url: string;
  serviceRoleKey: string;
  fetchImpl?: typeof fetch;
}): DemoDataStore {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = `${options.url.replace(/\/$/, "")}/rest/v1`;
  const headers = {
    apikey: options.serviceRoleKey,
    authorization: `Bearer ${options.serviceRoleKey}`,
    "content-type": "application/json",
  };

  async function request(pathname: string, init: RequestInit = {}): Promise<unknown> {
    const response = await fetchImpl(`${base}${pathname}`, {
      ...init,
      headers: { ...headers, ...(init.headers ?? {}) },
      cache: "no-store",
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`PostgreSQL gateway ${response.status}: ${body.slice(0, 240)}`);
    }
    if (response.status === 204) return null;
    const body = await response.text();
    return body ? JSON.parse(body) : null;
  }

  async function upsert<T>(
    table: string,
    conflictColumns: string[],
    match: Record<string, string>,
    row: Record<string, unknown>,
    value: T,
  ): Promise<UpsertResult<T>> {
    const lookup = new URLSearchParams({ select: conflictColumns.join(","), limit: "1" });
    for (const [column, columnValue] of Object.entries(match)) {
      lookup.set(column, `eq.${columnValue}`);
    }
    const existing = await request(`/${table}?${lookup}`) as unknown[];
    const query = new URLSearchParams({ on_conflict: conflictColumns.join(",") });
    await request(`/${table}?${query}`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(row),
    });
    return { value: structuredClone(value), created: existing.length === 0 };
  }

  return {
    ensureWorkspace: (input) => upsert(
      "workspaces",
      ["id"],
      { id: input.id },
      { id: input.id, name: input.name },
      input,
    ),
    ensureUser: (input) => upsert(
      "users",
      ["id"],
      { id: input.id },
      { id: input.id, email: input.email, display_name: input.displayName },
      input,
    ),
    ensureMembership: (input) => upsert(
      "workspace_members",
      ["workspace_id", "user_id"],
      { workspace_id: input.workspaceId, user_id: input.userId },
      { workspace_id: input.workspaceId, user_id: input.userId, role: input.role },
      input,
    ),
    ensureDocument: (input) => upsert(
      "source_documents",
      ["checksum"],
      { checksum: input.checksum },
      toDocumentRow(input),
      input,
    ),
    ensureWorkspaceDocument: (input) => upsert(
      "workspace_documents",
      ["workspace_id", "document_id"],
      { workspace_id: input.workspaceId, document_id: input.documentId },
      { workspace_id: input.workspaceId, document_id: input.documentId },
      input,
    ),
    async listWorkspaceDocumentIds(workspaceId) {
      const query = new URLSearchParams({
        workspace_id: `eq.${workspaceId}`,
        select: "document_id",
      });
      const rows = await request(`/workspace_documents?${query}`) as Array<{
        document_id: string;
      }>;
      return rows.map((row) => String(row.document_id)).sort();
    },
    ensureCompany: (input) => upsert(
      "companies",
      ["id"],
      { id: input.id },
      { id: input.id, workspace_id: input.workspaceId, name: input.name },
      input,
    ),
    ensureDeal: (input) => upsert(
      "deals",
      ["id"],
      { id: input.id },
      {
        id: input.id,
        workspace_id: input.workspaceId,
        company_id: input.companyId,
        company_name: input.companyName,
      },
      input,
    ),
    ensureEvidence: (input) => upsert(
      "source_evidence",
      ["id"],
      { id: input.id },
      {
        id: input.id,
        workspace_id: input.workspaceId,
        document_id: input.documentId,
        deal_id: input.dealId,
        company_name: input.companyName,
        provenance: input.provenance,
        page: input.page,
        fact: input.fact,
        excerpt: input.excerpt,
      },
      input,
    ),
    ensureFixture: (input) => upsert(
      "deal_interactions",
      ["id"],
      { id: input.id },
      {
        id: input.id,
        workspace_id: input.workspaceId,
        document_id: input.documentId,
        deal_id: input.dealId,
        company_name: input.companyName,
        occurred_at: input.occurredAt,
        provenance: input.provenance,
        label: input.label,
        status: input.status,
        concerns: input.concerns,
        revisit_conditions: input.revisitConditions,
        meeting_summary: input.meetingSummary,
      },
      input,
    ),
    async resetDemoData(resetOptions = {}) {
      const deletions: Array<[table: string, column: string, filter: string]> = [
        ["xtrace_memory_links", "workspace_id", "eq.workspace_demo"],
        ["xtrace_ingest_jobs", "workspace_id", "eq.workspace_demo"],
        ["market_events", "workspace_id", "eq.workspace_demo"],
        ["deal_interactions", "workspace_id", "eq.workspace_demo"],
        ["source_evidence", "workspace_id", "eq.workspace_demo"],
        ["workspace_documents", "workspace_id", "eq.workspace_demo"],
        ["deals", "workspace_id", "eq.workspace_demo"],
        ["companies", "workspace_id", "eq.workspace_demo"],
        [
          "source_documents",
          "id",
          `in.(${listPreloadedDocuments().map((document) => document.id).join(",")})`,
        ],
        ["workspace_members", "workspace_id", "eq.workspace_demo"],
        ["users", "id", "eq.user_demo"],
        ["workspaces", "id", "eq.workspace_demo"],
      ];
      if (resetOptions.includeHistory) {
        deletions.unshift(
          ["intelligence_reports", "workspace_id", "eq.workspace_demo"],
          ["scan_runs", "workspace_id", "eq.workspace_demo"],
        );
      }
      for (const [table, column, filter] of deletions) {
        const query = new URLSearchParams({ [column]: filter });
        await request(`/${table}?${query}`, { method: "DELETE" });
      }
    },
  };
}

export function createCorpusPersistence(
  dataStore: DemoDataStore,
  documentAccess: PrivateDocumentAccess,
): CorpusPersistence {
  return {
    async ensureWorkspaceDocument(input) {
      await dataStore.ensureWorkspaceDocument(input);
      return { documentId: input.documentId };
    },
    async ensureDeal(input) {
      if (!getPreloadedDeal(input.dealId)) {
        throw new Error(`Unknown preloaded Deal: ${input.dealId}`);
      }
      const companyId = companyIdForDeal(input.dealId);
      await dataStore.ensureCompany({
        id: companyId,
        workspaceId: input.workspaceId,
        name: input.companyName,
      });
      await dataStore.ensureDeal({
        id: input.dealId,
        workspaceId: input.workspaceId,
        companyId,
        companyName: input.companyName,
      });
      return { dealId: input.dealId };
    },
    async ensureFixture({ workspaceId, fixture }) {
      await dataStore.ensureFixture({ workspaceId, ...fixture });
      return { fixtureId: fixture.id };
    },
    createPrivateReadUrl: (input) => documentAccess.createPrivateReadUrl(input),
  };
}

export function createDefaultPrivateDocumentAccess(): PrivateDocumentAccess {
  const configuredSecret = process.env.DOCUMENT_URL_SIGNING_SECRET;
  if (!configuredSecret && process.env.NODE_ENV === "production") {
    throw new Error("DOCUMENT_URL_SIGNING_SECRET is required in production.");
  }
  return createPrivateDocumentAccess({
    signingSecret: configuredSecret ?? DEVELOPMENT_SIGNING_SECRET,
  });
}

export function createDefaultPrivateObjectStorage(): PrivateObjectStorage {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if ((!url || !serviceRoleKey) && process.env.NODE_ENV === "production") {
    throw new Error("Supabase private object storage is required in production.");
  }
  return url && serviceRoleKey
    ? createSupabasePrivateObjectStorage({
      url,
      serviceRoleKey,
      bucket: process.env.SUPABASE_STORAGE_BUCKET,
    })
    : createBundledPrivateObjectStorage();
}

export function createDefaultDemoDataStore(): DemoDataStore {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && serviceRoleKey) {
    return createSupabaseDemoDataStore({ url, serviceRoleKey });
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("Supabase PostgreSQL is required in production.");
  }
  return defaultMemoryDemoDataStore;
}

export function privateObjectKey(document: PreloadedDocument): string {
  return `private/demo-corpus/${document.checksum}/${document.filename}`;
}

export function companyIdForDocument(document: PreloadedDocument): string {
  if (document.role !== "deal_document") {
    throw new Error(`Document ${document.id} is not a Deal document.`);
  }
  if (!document.dealId) {
    throw new Error(`Document ${document.id} contains multiple Deals; provide a Deal id.`);
  }
  return companyIdForDeal(document.dealId);
}

export function companyIdForDeal(dealId: string): string {
  return `company_${dealId.replace(/^deal_/, "")}`;
}

async function ensureMemory<T>(
  target: Map<string, T>,
  key: string,
  input: T,
): Promise<UpsertResult<T>> {
  const created = !target.has(key);
  target.set(key, structuredClone(input));
  return { value: structuredClone(input), created };
}

function cloneValues<T>(values: Map<string, T>): T[] {
  return [...values.values()].map((value) => structuredClone(value));
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

const defaultMemoryDemoDataStore = createMemoryDemoDataStore();

function documentForObjectKey(key: string): PreloadedDocument | undefined {
  return listPreloadedDocuments().find((document) => privateObjectKey(document) === key);
}

function normalizeRoutePrefix(value: string): string {
  const normalized = value.startsWith("/") ? value : `/${value}`;
  return normalized.replace(/\/+$/, "");
}

async function signReadCapability(
  key: Promise<CryptoKey>,
  documentId: string,
  expires: number,
): Promise<string> {
  const signature = await globalThis.crypto.subtle.sign(
    "HMAC",
    await key,
    new TextEncoder().encode(`${documentId}:${expires}:read`),
  );
  return toBase64Url(new Uint8Array(signature));
}

async function verifyReadCapability(
  key: Promise<CryptoKey>,
  documentId: string,
  expires: number,
  signature: string,
): Promise<boolean> {
  let decoded: Uint8Array;
  try {
    decoded = fromBase64Url(signature);
  } catch {
    return false;
  }
  return globalThis.crypto.subtle.verify(
    "HMAC",
    await key,
    toArrayBuffer(decoded),
    new TextEncoder().encode(`${documentId}:${expires}:read`),
  );
}

function toBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(`${normalized}${padding}`);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeObjectPath(value: string): string {
  return value.split("/").map(encodeURIComponent).join("/");
}

async function storageHttpError(operation: string, response: Response): Promise<Error> {
  const body = await response.text();
  return new Error(`Private object ${operation} failed (${response.status}): ${body.slice(0, 240)}`);
}

function toDocumentRow(input: StoredCorpusDocument): Record<string, unknown> {
  return {
    id: input.id,
    filename: input.filename,
    title: input.title,
    role: input.role,
    company_name: input.company,
    deal_id: input.dealId,
    checksum: input.checksum,
    byte_size: input.byteSize,
    object_key: input.objectKey,
  };
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
