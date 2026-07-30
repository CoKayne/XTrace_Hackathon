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
