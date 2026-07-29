import {
  getWorkspaceMembershipsRepository,
  type WorkspaceMembershipRole,
  type WorkspaceMembershipsRepository,
} from "../../db/repositories/workspace-memberships";
import {
  resolveTrustedSession,
  type AuthenticatedPrincipal,
  type TrustedSessionResolver,
} from "./session";

export type DeploymentMode = "public_demo" | "product";
export type WorkspaceRole = WorkspaceMembershipRole | "demo";
export type { AuthenticatedPrincipal } from "./session";

export interface AuthorizedRequestContext {
  mode: DeploymentMode;
  principal: AuthenticatedPrincipal | null;
  workspaceId: string;
  role: WorkspaceRole;
  permissions: {
    readWorkspace: true;
    readPrivateSources: boolean;
    mutateSources: boolean;
    managePolicy: boolean;
    administerFrameworks: boolean;
  };
}

export async function resolveRequestContext(
  request: Request,
  dependencies: {
    environment?: Record<string, string | undefined>;
    resolveSession?: TrustedSessionResolver;
    memberships?: WorkspaceMembershipsRepository;
  } = {},
): Promise<AuthorizedRequestContext> {
  const environment = dependencies.environment ?? process.env;
  const mode = environment.VSEE_DEPLOYMENT_MODE;

  if (mode === "public_demo") {
    const workspaceId = environment.DEMO_WORKSPACE_ID?.trim();
    if (!workspaceId) throw new Error("INTERNAL_ERROR");
    return {
      mode,
      principal: null,
      workspaceId,
      role: "demo",
      permissions: {
        readWorkspace: true,
        readPrivateSources: false,
        mutateSources: false,
        managePolicy: false,
        administerFrameworks: false,
      },
    };
  }

  if (mode !== "product") throw new Error("INTERNAL_ERROR");

  const principal = await (dependencies.resolveSession ?? resolveTrustedSession)(request);
  if (!principal) throw new Error("UNAUTHENTICATED");

  const memberships = dependencies.memberships ?? getWorkspaceMembershipsRepository(environment);
  const membership = await memberships.resolvePrimaryMembership(principal.userId);
  if (!membership) throw new Error("FORBIDDEN");

  return {
    mode,
    principal,
    workspaceId: membership.workspaceId,
    role: membership.role,
    permissions: permissionsForRole(membership.role),
  };
}

function permissionsForRole(role: WorkspaceMembershipRole): AuthorizedRequestContext["permissions"] {
  if (role === "owner" || role === "admin") {
    return {
      readWorkspace: true,
      readPrivateSources: true,
      mutateSources: true,
      managePolicy: true,
      administerFrameworks: true,
    };
  }
  if (role === "partner") {
    return {
      readWorkspace: true,
      readPrivateSources: true,
      mutateSources: true,
      managePolicy: false,
      administerFrameworks: false,
    };
  }
  return {
    readWorkspace: true,
    readPrivateSources: true,
    mutateSources: false,
    managePolicy: false,
    administerFrameworks: false,
  };
}
