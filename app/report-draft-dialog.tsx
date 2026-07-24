"use client";

import { useEffect, useRef, useState } from "react";

import {
  buildFullDraftText,
  type InternalReportDraft,
} from "../lib/reports/draft";

export function ReportDraftDialog({
  draft,
  onClose,
}: {
  draft: InternalReportDraft | null;
  onClose(): void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [copyState, setCopyState] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (draft) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- opening a new native dialog resets its editable draft.
      setSubject(draft.subject);
      setBody(draft.bodyText);
      setCopyState("");
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [draft]);

  async function copy(value: string, success: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyState(success);
    } catch {
      setCopyState("Copy unavailable — select the text manually.");
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="vsee-draft-dialog"
      aria-labelledby="report-draft-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
    >
      <form method="dialog" className="vsee-draft-composer">
        <header>
          <div>
            <span>INTERNAL VC / GP BRIEF</span>
            <h2 id="report-draft-title">Draft this report</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close report draft">
            ×
          </button>
        </header>
        <main>
          <label>
            <span>Subject</span>
            <input
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              autoFocus
            />
          </label>
          <label>
            <span>Message</span>
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={20}
            />
          </label>
        </main>
        <footer>
          <p aria-live="polite">{copyState}</p>
          <div>
            <button type="button" onClick={() => void copy(body, "BODY COPIED ✓")}>
              COPY BODY
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => void copy(
                buildFullDraftText({ subject, bodyText: body }),
                "FULL DRAFT COPIED ✓",
              )}
            >
              COPY FULL DRAFT
            </button>
            <button type="button" onClick={onClose}>CLOSE</button>
          </div>
        </footer>
      </form>
    </dialog>
  );
}
