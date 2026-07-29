export interface AuthenticatedPrincipal {
  userId: string;
  email: string;
}

export type TrustedSessionResolver = (
  request: Request,
) => Promise<AuthenticatedPrincipal | null>;

// Production deployments must replace this adapter with their verified session
// integration. Request metadata is never treated as an authenticated identity.
export const resolveTrustedSession: TrustedSessionResolver = async () => null;
