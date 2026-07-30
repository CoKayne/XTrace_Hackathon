"use client";

import { useState } from "react";

import { apiRequest } from "./api-client";

export function SourceRevisionLink({
  revisionId,
  children,
}: {
  revisionId: string;
  children?: React.ReactNode;
}) {
  const [error, setError] = useState("");
  const accessPath =
    `/api/source-revisions/${encodeURIComponent(revisionId)}/access`;

  async function openRevision(
    event: React.MouseEvent<HTMLAnchorElement>,
  ) {
    event.preventDefault();
    const pendingWindow = window.open("about:blank", "_blank");
    if (pendingWindow) pendingWindow.opener = null;
    setError("");
    try {
      const access = await apiRequest<{ url: string; expiresAt: string }>(
        accessPath,
      );
      if (pendingWindow) pendingWindow.location.replace(access.url);
      else window.location.assign(access.url);
    } catch (accessError) {
      pendingWindow?.close();
      setError(
        accessError instanceof Error
          ? accessError.message
          : "Source Revision could not be opened.",
      );
    }
  }

  return (
    <span className="vsee-source-revision-link">
      <a
        href={accessPath}
        onClick={(event) => void openRevision(event)}
        target="_blank"
        rel="noreferrer"
      >
        {children ?? `Source Revision · ${revisionId} ↗`}
      </a>
      {error && <small role="alert">{error}</small>}
    </span>
  );
}
