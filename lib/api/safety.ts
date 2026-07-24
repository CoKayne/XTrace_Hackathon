type Environment = Record<string, string | undefined>;

interface RateLimitInput {
  scope: string;
  clientId: string;
  limit: number;
  windowMs: number;
  now?: () => number;
}

interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

interface PersistentRateLimitOptions {
  environment?: Environment;
  fetchImpl?: typeof fetch;
}

const requestWindows = new Map<string, number[]>();

export function clientIdentifier(request: Request): string {
  return request.headers.get("cf-connecting-ip")?.trim()
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown-client";
}

export function takePublicRequest(input: RateLimitInput): RateLimitResult {
  const now = input.now ?? Date.now;
  const current = now();
  const key = `${input.scope}:${input.clientId}`;
  const timestamps = requestWindows.get(key) ?? [];
  const active = timestamps.filter((timestamp) =>
    timestamp > current - input.windowMs
  );
  if (active.length >= input.limit) {
    requestWindows.set(key, active);
    return {
      allowed: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((active[0] + input.windowMs - current) / 1_000),
      ),
    };
  }
  active.push(current);
  requestWindows.set(key, active);
  return { allowed: true, retryAfterSeconds: 0 };
}

export async function rateLimitRequest(
  request: Request,
  scope: string,
  limit: number,
  windowMs = 60_000,
  options: PersistentRateLimitOptions = {},
): Promise<RateLimitResult> {
  const environment = options.environment ?? process.env;
  const url = environment.SUPABASE_URL;
  const serviceRoleKey = environment.SUPABASE_SERVICE_ROLE_KEY;
  if (url && serviceRoleKey) {
    const clientHash = await digestClientIdentifier(clientIdentifier(request));
    const response = await (options.fetchImpl ?? fetch)(
      `${url.replace(/\/$/, "")}/rest/v1/rpc/take_public_request`,
      {
        method: "POST",
        headers: {
          apikey: serviceRoleKey,
          authorization: `Bearer ${serviceRoleKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          p_scope: scope,
          p_client_hash: clientHash,
          p_limit: limit,
          p_window_seconds: Math.max(1, Math.ceil(windowMs / 1_000)),
        }),
        cache: "no-store",
      },
    );
    if (!response.ok) {
      return { allowed: false, retryAfterSeconds: 60 };
    }
    const rows = await response.json() as Array<{
      allowed: boolean;
      retry_after_seconds: number;
    }>;
    return {
      allowed: Boolean(rows[0]?.allowed),
      retryAfterSeconds: Math.max(0, Number(rows[0]?.retry_after_seconds ?? 0)),
    };
  }
  if (environment.NODE_ENV === "production") {
    return { allowed: false, retryAfterSeconds: 60 };
  }
  return takePublicRequest({
    scope,
    clientId: clientIdentifier(request),
    limit,
    windowMs,
  });
}

async function digestClientIdentifier(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function isAllowedReportRecipient(
  recipient: string,
  environment: Environment = process.env,
): boolean {
  const allowed = [
    environment.REPORT_TO_EMAIL,
    ...(environment.REPORT_ALLOWED_RECIPIENTS?.split(",") ?? []),
  ]
    .map((value) => value?.trim().toLocaleLowerCase())
    .filter((value): value is string => Boolean(value));
  return allowed.includes(recipient.trim().toLocaleLowerCase());
}
