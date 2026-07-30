"use client";

import { useEffect, useRef, useState } from "react";

import type { PublicActionDraft } from "../lib/underwriting/read-model";
import { apiRequest } from "./api-client";

export async function saveActionDraftBody(input: {
  draftId: string;
  body: string;
  request?: (
    url: string,
    init: RequestInit,
  ) => Promise<PublicActionDraft>;
}): Promise<PublicActionDraft> {
  const request = input.request
    ?? ((url: string, init: RequestInit) =>
      apiRequest<PublicActionDraft>(url, init));
  return request(
    `/api/action-drafts/${encodeURIComponent(input.draftId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ body: input.body }),
    },
  );
}

export function ActionDraftDialog({
  draft,
  canSave,
  onClose,
  onSaved,
}: {
  draft: PublicActionDraft | null;
  canSave: boolean;
  onClose(): void;
  onSaved(draft: PublicActionDraft): void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (draft && dialog && !dialog.open) dialog.showModal();
    if (!draft && dialog?.open) dialog.close();
  }, [draft]);

  return (
    <dialog
      className="vsee-action-draft-dialog"
      ref={dialogRef}
      aria-labelledby="action-draft-title"
      onClose={onClose}
    >
      {draft && (
        <div className="vsee-action-draft-card">
          <header>
            <div>
              <span className="vsee-eyebrow">LATEST-ONLY ACTION DRAFT</span>
              <h2 id="action-draft-title">
                {humanize(draft.audienceType)} draft
              </h2>
              <p>
                Save replaces only this draft&apos;s current persisted body.
                No delivery occurs.
              </p>
            </div>
            <button onClick={onClose} aria-label="Close action draft">×</button>
          </header>
          <ActionDraftSession
            key={draft.id}
            draft={draft}
            canSave={canSave}
            onSaved={onSaved}
          />
        </div>
      )}
    </dialog>
  );
}

function ActionDraftSession({
  draft,
  canSave,
  onSaved,
}: {
  draft: PublicActionDraft;
  canSave: boolean;
  onSaved(draft: PublicActionDraft): void;
}) {
  const [body, setBody] = useState(draft.body);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  async function save() {
    if (!canSave || !body.trim()) return;
    setSaving(true);
    setStatusMessage("");
    try {
      const updated = await saveActionDraftBody({
        draftId: draft.id,
        body,
      });
      setBody(updated.body);
      onSaved(updated);
      setStatusMessage("Current body saved.");
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Current body was not saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(body);
      setStatusMessage("Current body copied.");
    } catch {
      setStatusMessage("Copy is unavailable in this browser.");
    }
  }

  function download() {
    const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = `${draft.id}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(href);
    setStatusMessage("Current body downloaded.");
  }

  return (
    <ActionDraftEditor
      draft={draft}
      body={body}
      saving={saving}
      canSave={canSave}
      statusMessage={statusMessage}
      onBodyChange={setBody}
      onSave={() => void save()}
      onCopy={() => void copy()}
      onDownload={download}
    />
  );
}

export function ActionDraftEditor({
  draft,
  body,
  saving,
  canSave,
  statusMessage,
  onBodyChange,
  onSave,
  onCopy,
  onDownload,
}: {
  draft: PublicActionDraft;
  body: string;
  saving: boolean;
  canSave: boolean;
  statusMessage: string;
  onBodyChange(body: string): void;
  onSave(): void;
  onCopy(): void;
  onDownload(): void;
}) {
  const dirty = body !== draft.body;
  return (
    <div className="vsee-action-draft-editor">
      <label>
        <span>Current body</span>
        <textarea
          rows={16}
          value={body}
          onChange={(event) => onBodyChange(event.target.value)}
          aria-describedby="action-draft-boundary"
        />
      </label>
      <p id="action-draft-boundary">
        Draft-only boundary · copy, download, or save this current body.
      </p>
      {!canSave && (
        <p className="vsee-readonly-note" role="status">
          Saving is disabled in this read-only public demo.
        </p>
      )}
      <footer>
        <p aria-live="polite">{statusMessage}</p>
        <div>
          <button onClick={onCopy} disabled={!body}>COPY CURRENT BODY</button>
          <button onClick={onDownload} disabled={!body}>
            DOWNLOAD .TXT
          </button>
          <button
            className="primary"
            onClick={onSave}
            disabled={!canSave || saving || !dirty || !body.trim()}
          >
            {saving ? "SAVING…" : "SAVE CURRENT BODY"}
          </button>
        </div>
      </footer>
    </div>
  );
}

function humanize(value: string): string {
  return value.replaceAll("_", " ").replace(/^./, (letter) =>
    letter.toUpperCase()
  );
}
