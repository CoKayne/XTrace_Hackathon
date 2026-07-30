import type { AuthorizedRequestContext } from "../lib/auth/request-context";

export interface UiCapabilities {
  runScans: boolean;
  resetDemo: boolean;
  uploadSources: boolean;
  confirmUploads: boolean;
  manageFundPolicy: boolean;
  saveActionDrafts: boolean;
}

export interface UiSession {
  deploymentMode: AuthorizedRequestContext["mode"];
  capabilities: UiCapabilities;
}

interface ReportAppOriginInput {
  deploymentMode: AuthorizedRequestContext["mode"];
  canonicalAppOrigin?: string;
  browserOrigin: string;
}

export const SAFE_UI_SESSION: UiSession = {
  deploymentMode: "public_demo",
  capabilities: {
    runScans: false,
    resetDemo: false,
    uploadSources: false,
    confirmUploads: false,
    manageFundPolicy: false,
    saveActionDrafts: false,
  },
};

export function canonicalPublicAppOrigin(
  configuredUrl: string | undefined,
): string | undefined {
  if (!configuredUrl?.trim()) return undefined;

  try {
    const url = new URL(configuredUrl);
    const localHttp =
      url.protocol === "http:"
      && (
        url.hostname === "localhost"
        || url.hostname === "127.0.0.1"
        || url.hostname === "[::1]"
      );
    if (
      (url.protocol !== "https:" && !localHttp)
      || url.username
      || url.password
      || url.pathname !== "/"
      || url.search
      || url.hash
    ) {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
}

export function resolveReportAppOrigin(
  input: ReportAppOriginInput,
): string {
  if (input.deploymentMode !== "public_demo") return input.browserOrigin;
  return canonicalPublicAppOrigin(input.canonicalAppOrigin)
    ?? input.browserOrigin;
}

export function uiSessionForContext(
  context: AuthorizedRequestContext,
): UiSession {
  const product = context.mode === "product";
  const sandbox = context.mode === "public_sandbox";
  const durableWorkspace = product || sandbox;
  return {
    deploymentMode: context.mode,
    capabilities: {
      runScans: durableWorkspace,
      // Reset deletes durable analysis products and is intentionally not
      // presented as an authenticated-product capability.
      resetDemo: sandbox,
      uploadSources: durableWorkspace && context.permissions.mutateSources,
      confirmUploads: durableWorkspace && context.permissions.mutateSources,
      manageFundPolicy: durableWorkspace && context.permissions.managePolicy,
      saveActionDrafts: durableWorkspace && context.principal !== null,
    },
  };
}
