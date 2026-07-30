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
  return {
    deploymentMode: context.mode,
    capabilities: {
      runScans: product,
      // Reset deletes durable analysis products and is intentionally not
      // presented as an end-user capability in either deployment mode.
      resetDemo: false,
      uploadSources: product && context.permissions.mutateSources,
      confirmUploads: product && context.permissions.mutateSources,
      manageFundPolicy: product && context.permissions.managePolicy,
      saveActionDrafts: product && context.principal !== null,
    },
  };
}
