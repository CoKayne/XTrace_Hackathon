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
  success?: boolean;
  data: XTraceSearchResult[];
  context?: string;
  count?: number;
};

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

export function createXTraceClient(options: {
  apiKey: string;
  orgId: string;
  baseUrl?: string;
  fetch?: FetchLike;
}): XTraceClient {
  const baseUrl = (options.baseUrl ?? XTRACE_API_BASE_URL).replace(/\/$/, "");
  const fetchImpl = options.fetch ?? fetch;
  const headers = {
    Authorization: `Bearer ${options.apiKey}`,
    "X-Org-Id": options.orgId,
    "Content-Type": "application/json",
  };

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
  const apiKey = process.env.XTRACE_API_KEY;
  const orgId = process.env.XTRACE_ORG_ID;
  if (!apiKey || !orgId) throw new XTraceConfigurationError();

  return createXTraceClient({
    apiKey,
    orgId,
    baseUrl: process.env.XTRACE_API_BASE_URL,
  });
}

function normalizeSearchResponse(response: unknown): XTraceSearchResponse {
  if (!isRecord(response)) return { data: [] };
  const rows = Array.isArray(response.data)
    ? response.data
    : Array.isArray(response.results)
      ? response.results
      : [];
  return {
    success: typeof response.success === "boolean" ? response.success : undefined,
    context: typeof response.context === "string" ? response.context : undefined,
    count: typeof response.count === "number" ? response.count : undefined,
    data: rows.flatMap(normalizeSearchResult),
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
