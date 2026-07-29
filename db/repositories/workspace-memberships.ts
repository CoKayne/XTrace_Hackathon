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
  const base = `${options.url.replace(/\/$/, "")}/rest/v1`;
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers = {
    apikey: options.serviceRoleKey,
    authorization: `Bearer ${options.serviceRoleKey}`,
  };

  return {
    async resolvePrimaryMembership(userId) {
      const response = await fetchImpl(
        `${base}/workspace_members?user_id=eq.${encodeURIComponent(userId)}&select=workspace_id,role&order=workspace_id.asc&limit=1`,
        { headers, cache: "no-store" },
      );
      if (!response.ok) {
        throw new Error(`PostgreSQL gateway ${response.status}`);
      }
      const rows = await response.json() as Array<Record<string, unknown>>;
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
  const url = environment.SUPABASE_URL;
  const serviceRoleKey = environment.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new Error("INTERNAL_ERROR");
  return createSupabaseWorkspaceMembershipsRepository({ url, serviceRoleKey });
}

function isWorkspaceMembershipRole(value: unknown): value is WorkspaceMembershipRole {
  return value === "owner" || value === "partner" || value === "associate" || value === "admin";
}
