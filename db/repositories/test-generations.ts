import {
  IntegrationTransportError,
  isRetryableTransportStatus,
} from "../../lib/api/errors";

export class ActiveScanResetError extends Error {
  constructor() {
    super("The current test view cannot be reset while a scan is active.");
    this.name = "ActiveScanResetError";
  }
}

export interface TestGenerationRepository {
  currentResetAt(workspaceId: string): Promise<string | null>;
  advance(input: {
    workspaceId: string;
    actorId: string;
  }): Promise<{ resetAt: string }>;
}

export function afterReset(value: string, resetAt: string | null): boolean {
  return resetAt === null
    || new Date(value).getTime() > new Date(resetAt).getTime();
}

export function filterAfterReset<T extends { createdAt: string }>(
  rows: T[],
  resetAt: string | null,
): T[] {
  return rows.filter(({ createdAt }) => afterReset(createdAt, resetAt));
}

function requiredIdentity(value: string, label: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

export function createMemoryTestGenerationRepository(options: {
  now?: () => Date;
  hasActiveScan?: (workspaceId: string) => Promise<boolean>;
} = {}): TestGenerationRepository {
  const resetByWorkspace = new Map<string, string>();
  const now = options.now ?? (() => new Date());
  const hasActiveScan = options.hasActiveScan ?? (async () => false);

  return {
    async currentResetAt(workspaceId) {
      workspaceId = requiredIdentity(workspaceId, "A workspace");
      return resetByWorkspace.get(workspaceId) ?? null;
    },
    async advance(input) {
      const workspaceId = requiredIdentity(input.workspaceId, "A workspace");
      requiredIdentity(input.actorId, "An actor");
      if (await hasActiveScan(workspaceId)) {
        throw new ActiveScanResetError();
      }
      const marker = now();
      if (!Number.isFinite(marker.getTime())) {
        throw new TypeError("Reset requires a valid current time.");
      }
      const resetAt = marker.toISOString();
      resetByWorkspace.set(workspaceId, resetAt);
      return { resetAt };
    },
  };
}

export function createSupabaseTestGenerationRepository(options: {
  url: string;
  serviceRoleKey: string;
  fetchImpl?: typeof fetch;
}): TestGenerationRepository {
  const base = `${options.url.replace(/\/$/, "")}/rest/v1`;
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers = {
    apikey: options.serviceRoleKey,
    authorization: `Bearer ${options.serviceRoleKey}`,
    "content-type": "application/json",
  };

  async function request(path: string, init: RequestInit = {}) {
    let response: Response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        ...init,
        headers: { ...headers, ...(init.headers ?? {}) },
        cache: "no-store",
      });
    } catch {
      throw new IntegrationTransportError({ retryable: true });
    }
    if (!response.ok) {
      throw new IntegrationTransportError({
        retryable: isRetryableTransportStatus(response.status),
      });
    }
    if (response.status === 204) return null;
    const body = await response.text();
    return body.trim() ? JSON.parse(body) : null;
  }

  return {
    async currentResetAt(workspaceId) {
      workspaceId = requiredIdentity(workspaceId, "A workspace");
      const rows = await request(
        `/workspace_test_generations?workspace_id=eq.${encodeURIComponent(workspaceId)}`
        + "&select=reset_at&limit=1",
      ) as Array<{ reset_at: string }>;
      return rows[0]?.reset_at ? String(rows[0].reset_at) : null;
    },
    async advance(input) {
      const workspaceId = requiredIdentity(input.workspaceId, "A workspace");
      const actorId = requiredIdentity(input.actorId, "An actor");
      const result = await request("/rpc/reset_test_view", {
        method: "POST",
        body: JSON.stringify({
          p_workspace_id: workspaceId,
          p_actor_id: actorId,
        }),
      }) as {
        reset?: boolean;
        resetAt?: string;
        reason?: string;
      };
      if (result?.reason === "active_scan") {
        throw new ActiveScanResetError();
      }
      if (result?.reset !== true || !result.resetAt) {
        throw new Error("The controlled reset operation returned an invalid result.");
      }
      return { resetAt: String(result.resetAt) };
    },
  };
}

let singleton: TestGenerationRepository | undefined;

export function getTestGenerationRepository(): TestGenerationRepository {
  if (singleton) return singleton;
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  singleton = url && serviceRoleKey
    ? createSupabaseTestGenerationRepository({ url, serviceRoleKey })
    : createMemoryTestGenerationRepository({
      async hasActiveScan(workspaceId) {
        const { getDataClient } = await import("../client");
        const runs = await getDataClient().listRuns(workspaceId);
        return runs.some(({ status }) =>
          status === "queued" || status === "running"
        );
      },
    });
  return singleton;
}
