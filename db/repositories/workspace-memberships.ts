import {
  IntegrationTransportError,
  isRetryableTransportStatus,
} from "../../lib/api/errors";

export type WorkspaceMembershipRole = "owner" | "partner" | "associate" | "admin";

export interface WorkspaceMembershipsRepository {
  resolvePrimaryMembership(userId: string): Promise<{
    workspaceId: string;
    role: WorkspaceMembershipRole;
  } | null>;
}

export function createSupabaseWorkspaceMembershipsRepository(options: {
  url: string;
  serviceRoleKey: string;
  fetchImpl?: typeof fetch;
}): WorkspaceMembershipsRepository {
  const configuration = parseSupabaseConfiguration(options);
  const base = `${configuration.url}/rest/v1`;
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers = {
    apikey: configuration.serviceRoleKey,
    authorization: `Bearer ${configuration.serviceRoleKey}`,
  };

  return {
    async resolvePrimaryMembership(userId) {
      let response: Response;
      try {
        response = await fetchImpl(
          `${base}/workspace_members?user_id=eq.${encodeURIComponent(userId)}&select=workspace_id,role&limit=2`,
          { headers, cache: "no-store" },
        );
      } catch {
        throw new IntegrationTransportError({ retryable: true });
      }
      if (!response.ok) {
        throw new IntegrationTransportError({
          retryable: isRetryableTransportStatus(response.status),
        });
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new Error("INTERNAL_ERROR");
      }
      if (!Array.isArray(payload)) throw new Error("INTERNAL_ERROR");
      const rows = payload as Array<Record<string, unknown>>;
      if (rows.length !== 1) return null;
      const row = rows[0];
      const workspaceId = typeof row?.workspace_id === "string" ? row.workspace_id.trim() : "";
      const role = row?.role;
      if (!workspaceId || !isWorkspaceMembershipRole(role)) return null;
      return { workspaceId, role };
    },
  };
}

export function getWorkspaceMembershipsRepository(
  environment: Record<string, string | undefined> = process.env,
): WorkspaceMembershipsRepository {
  return createSupabaseWorkspaceMembershipsRepository({
    url: environment.SUPABASE_URL ?? "",
    serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY ?? "",
  });
}

function parseSupabaseConfiguration(input: {
  url: string;
  serviceRoleKey: string;
}): { url: string; serviceRoleKey: string } {
  const url = input.url.trim().replace(/\/$/, "");
  const serviceRoleKey = input.serviceRoleKey.trim();
  if (!url || !serviceRoleKey) throw new Error("INTERNAL_ERROR");
  try {
    const parsed = new URL(url);
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.hostname) {
      throw new Error("invalid URL");
    }
  } catch {
    throw new Error("INTERNAL_ERROR");
  }
  return { url, serviceRoleKey };
}

function isWorkspaceMembershipRole(value: unknown): value is WorkspaceMembershipRole {
  return value === "owner" || value === "partner" || value === "associate" || value === "admin";
}
