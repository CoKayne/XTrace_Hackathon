export const XTRACE_API_BASE_URL = "https://api.production.xtrace.ai";

export type XTraceMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type XTraceIngestRequest = {
  messages: XTraceMessage[];
  user_id: string;
  conv_id: string;
  agent_id?: string;
  app_id?: string;
  group_ids?: string[];
  timestamp_format?: string;
  extract_artifacts?: boolean;
};

export type XTraceMemoryRef = {
  id: string;
  type: string;
  text: string;
};

export type XTraceJob = {
  status: "pending" | "running" | "succeeded" | "failed";
  id: string;
  result?: {
    memories_created?: XTraceMemoryRef[];
  } | null;
  error?: { code?: string; message?: string } | null;
};

export type XTraceSearchRequest = {
  query: string;
  user_id: string;
  app_id?: string;
  agent_id?: string;
  group_ids?: string[];
  mode: "retrieve";
  limit: number;
};

export type XTraceSearchResult = {
  id: string;
  type?: string;
  text: string;
  score: number;
  user_id?: string | null;
  conv_id?: string | null;
  app_id?: string | null;
  agent_id?: string | null;
  metadata?: Record<string, unknown>;
};

export type XTraceSearchResponse = {
  success?: true;
  object?: "search";
  mode?: "retrieve" | "compose";
  data: XTraceSearchResult[];
  context?: string;
  count?: number;
};

export function isAcceptedXTraceSearchResponse(
  response: XTraceSearchResponse,
): boolean {
  const envelope = response as { success?: unknown; object?: unknown; mode?: unknown };
  if (envelope.success !== undefined && envelope.success !== true) return false;
  return envelope.success === true
    || (envelope.object === "search"
      && (envelope.mode === "retrieve" || envelope.mode === "compose"));
}

export type XTraceClient = {
  ingest(input: XTraceIngestRequest, options?: { wait?: boolean }): Promise<XTraceJob>;
  getJob(jobId: string): Promise<XTraceJob>;
  search(input: XTraceSearchRequest): Promise<XTraceSearchResponse>;
  deleteMemory(memoryId: string): Promise<void>;
};

export class XTraceConfigurationError extends Error {
  readonly code = "XTRACE_NOT_CONFIGURED";

  constructor(message = "XTrace credentials are not configured") {
    super(message);
    this.name = "XTraceConfigurationError";
  }
}

export class XTraceHttpError extends Error {
  constructor(
    readonly status: number,
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = "XTraceHttpError";
  }
}

type FetchLike = typeof fetch;

type XTraceEnvironment = Partial<Pick<
  NodeJS.ProcessEnv,
  "XTRACE_API_KEY" | "XTRACE_ORG_ID"
>>;

export function isXTraceConfigured(
  environment: XTraceEnvironment | NodeJS.ProcessEnv = process.env,
): boolean {
  const apiKey = environment.XTRACE_API_KEY?.trim();
  if (!apiKey) return false;
  return apiKey.startsWith("mmk_")
    || Boolean(environment.XTRACE_ORG_ID?.trim());
}

export function createXTraceClient(options: {
  apiKey: string;
  orgId?: string;
  baseUrl?: string;
  fetch?: FetchLike;
}): XTraceClient {
  const baseUrl = (options.baseUrl ?? XTRACE_API_BASE_URL).replace(/\/$/, "");
  const fetchImpl = options.fetch ?? fetch;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (options.apiKey.startsWith("mmk_")) {
    headers["x-api-key"] = options.apiKey;
  } else {
    headers.Authorization = `Bearer ${options.apiKey}`;
  }
  if (!options.apiKey.startsWith("mmk_") && options.orgId?.trim()) {
    headers["X-Org-Id"] = options.orgId.trim();
  }

  const request = async <T>(path: string, init: RequestInit): Promise<T> => {
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        headers: { ...headers, ...init.headers },
        signal: init.signal ?? AbortSignal.timeout(30_000),
      });
    } catch {
      throw new XTraceHttpError(0, true, "XTrace request could not be completed");
    }

    const payload = await response.json().catch(() => undefined) as unknown;
    if (!response.ok) {
      console.error("[xtrace-debug] non-OK", {
        status: response.status,
        contentType: response.headers.get("content-type"),
        apiKeyLength: options.apiKey.length,
        apiKeyKind: options.apiKey.startsWith("mmk_") ? "mmk" : "legacy",
      });
      const error = isRecord(payload) && isRecord(payload.error) ? payload.error : undefined;
      const message = typeof error?.message === "string"
        ? error.message
        : "XTrace request failed";
      throw new XTraceHttpError(response.status, response.status === 429 || response.status >= 500, message);
    }
    return payload as T;
  };

  return {
    ingest: (input, options) => request<XTraceJob>(`/v1/memories${waitQuery(options?.wait)}`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
    getJob: (jobId) => request<XTraceJob>(`/v1/memories/jobs/${encodeURIComponent(jobId)}`, {
      method: "GET",
    }),
    search: async (input) => {
      const response = await request<unknown>("/v1/memories/search", {
        method: "POST",
        body: JSON.stringify(input),
      });
      return normalizeSearchResponse(response);
    },
    deleteMemory: async (memoryId) => {
      await request<unknown>(`/v1/memories/${encodeURIComponent(memoryId)}`, {
        method: "DELETE",
      });
    },
  };
}

function waitQuery(wait: boolean | undefined): string {
  return wait ? "?wait=true" : "";
}

export function getXTraceClient(): XTraceClient {
  if (typeof window !== "undefined") {
    throw new XTraceConfigurationError("XTrace client may only be created on the server");
  }
  if (!isXTraceConfigured()) throw new XTraceConfigurationError();

  const apiKey = process.env.XTRACE_API_KEY!.trim();
  return createXTraceClient({
    apiKey,
    orgId: apiKey.startsWith("mmk_")
      ? undefined
      : process.env.XTRACE_ORG_ID?.trim(),
    baseUrl: process.env.XTRACE_API_BASE_URL,
  });
}

function normalizeSearchResponse(response: unknown): XTraceSearchResponse {
  if (!isRecord(response) || !Array.isArray(response.data) || response.success === false) {
    throw new XTraceHttpError(200, false, "XTrace search response was invalid");
  }
  const legacyEnvelope = response.success === true;
  const documentedEnvelope =
    response.object === "search"
    && (response.mode === "retrieve" || response.mode === "compose")
    && (typeof response.context === "string" || response.context === null)
    && isRecord(response.stage_timings)
    && typeof response.context_selection_applied === "boolean";
  if (!legacyEnvelope && !documentedEnvelope) {
    throw new XTraceHttpError(200, false, "XTrace search response was invalid");
  }
  return {
    ...(legacyEnvelope ? { success: true as const } : {}),
    ...(documentedEnvelope
      ? {
          object: "search" as const,
          mode: response.mode as "retrieve" | "compose",
        }
      : {}),
    context: typeof response.context === "string" ? response.context : undefined,
    count: typeof response.count === "number" ? response.count : undefined,
    data: response.data.flatMap(normalizeSearchResult),
  };
}

function normalizeSearchResult(row: unknown): XTraceSearchResult[] {
  if (!isRecord(row) || typeof row.id !== "string" || typeof row.text !== "string") return [];
  return [{
    id: row.id,
    text: row.text,
    type: typeof row.type === "string" ? row.type : undefined,
    score: typeof row.score === "number" ? row.score : 0,
    user_id: typeof row.user_id === "string" ? row.user_id : null,
    conv_id: typeof row.conv_id === "string" ? row.conv_id : null,
    app_id: typeof row.app_id === "string" ? row.app_id : null,
    agent_id: typeof row.agent_id === "string" ? row.agent_id : null,
    metadata: isRecord(row.metadata) ? row.metadata : undefined,
  }];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
