"use client";

import { useRef, useState } from "react";

import type { DealStatus } from "../lib/contracts/domain";
import type { ConfirmUpload } from "../lib/contracts/http";
import type {
  UploadRecoveryDetailDto,
} from "../lib/uploads/confirmation";
import { SourceRevisionLink } from "./source-revision-link";
import { describeUploadState } from "./underwriting-view-model";

export type SourceUploadDto = UploadRecoveryDetailDto;

export function SourceUploadFlow({
  uploads,
  canUpload,
  canConfirm,
  uploading,
  confirmingUploadId,
  onUpload,
  onConfirm,
}: {
  uploads: SourceUploadDto[];
  canUpload: boolean;
  canConfirm: boolean;
  uploading: boolean;
  confirmingUploadId: string | null;
  onUpload(file: File): void;
  onConfirm(uploadId: string, choice: ConfirmUpload): void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <section className="vsee-upload-panel" aria-labelledby="upload-title">
      <header>
        <div>
          <span className="vsee-eyebrow">CANONICAL SOURCE INTAKE</span>
          <h2 id="upload-title">Upload a source for review.</h2>
          <p>
            TXT, Markdown, PDF, DOCX, PNG, or WebP · 12 MB maximum. Extraction
            stops at a preview until a user confirms both company identity and
            Deal ownership.
          </p>
          {!canUpload && (
            <p className="vsee-readonly-note" role="status">
              Upload and confirmation are disabled in this read-only public
              demo.
            </p>
          )}
        </div>
        <button
          className="primary"
          onClick={() => inputRef.current?.click()}
          disabled={!canUpload || uploading}
          title={!canUpload
            ? "The server did not grant source mutation."
            : undefined}
        >
          {uploading ? "UPLOADING…" : "UPLOAD DOCUMENT"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".txt,.md,.pdf,.docx,.png,.webp"
          aria-label="Choose a source document"
          disabled={!canUpload || uploading}
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onUpload(file);
            event.target.value = "";
          }}
        />
      </header>

      {uploads.length === 0 ? (
        <p className="vsee-upload-empty">
          {canUpload
            ? "No runtime uploads yet."
            : "Runtime uploads are private and are not available in public demo mode."}
        </p>
      ) : (
        <div className="vsee-upload-list">
          {uploads.map((upload) => (
            <UploadRow
              key={upload.uploadId}
              upload={upload}
              canConfirm={canConfirm}
              confirming={confirmingUploadId === upload.uploadId}
              onConfirm={onConfirm}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function UploadRow({
  upload,
  canConfirm,
  confirming,
  onConfirm,
}: {
  upload: SourceUploadDto;
  canConfirm: boolean;
  confirming: boolean;
  onConfirm(uploadId: string, choice: ConfirmUpload): void;
}) {
  const [companyName, setCompanyName] = useState(
    upload.preview?.candidateCompanyName ?? "",
  );
  const [assignment, setAssignment] = useState(
    upload.candidateDeals[0]
      ? `existing:${upload.candidateDeals[0].dealId}`
      : "new",
  );
  const [newDealStatus, setNewDealStatus] =
    useState<DealStatus>("screening");
  const [ownershipConfirmed, setOwnershipConfirmed] = useState(false);
  const state = describeUploadState(upload);
  const confirmable = upload.status === "awaiting_confirmation";
  const valid = companyName.trim().length > 0 && ownershipConfirmed;

  function confirm() {
    if (!valid || !canConfirm) return;
    const choice: ConfirmUpload = assignment.startsWith("existing:")
      ? {
          companyName: companyName.trim(),
          assignment: {
            kind: "existing_deal",
            dealId: assignment.slice("existing:".length),
          },
        }
      : {
          companyName: companyName.trim(),
          assignment: {
            kind: "new_deal",
            dealStatus: newDealStatus,
          },
        };
    onConfirm(upload.uploadId, choice);
  }

  return (
    <article className={`vsee-upload-row ${state.tone}`}>
      <div className="vsee-upload-identity">
        <strong>
          {upload.preview?.candidateCompanyName ?? upload.filename}
        </strong>
        <small>{upload.filename} · {upload.contentType}</small>
        <small>Upload ID · {upload.uploadId}</small>
      </div>
      <span className={`vsee-upload-status ${state.tone}`}>
        {state.label}
      </span>
      <p>{state.description}</p>

      {confirmable && (
        <section
          className="vsee-upload-confirmation"
          aria-labelledby={`confirm-${upload.uploadId}`}
        >
          <header>
            <span className="vsee-eyebrow">EXTRACTION PREVIEW</span>
            <h3 id={`confirm-${upload.uploadId}`}>
              Confirm company &amp; Deal ownership
            </h3>
            <p>
              {upload.preview?.candidateHeadline
                ?? "No extracted headline was available."}
            </p>
          </header>
          <div className="vsee-upload-facts">
            {(upload.preview?.facts ?? []).map((fact, index) => (
              <article key={`${upload.uploadId}-fact-${index}`}>
                <strong>{fact.text}</strong>
                <span>{fact.excerpt ?? "Located in uploaded image"}</span>
              </article>
            ))}
          </div>
          <div className="vsee-upload-confirm-fields">
            <label>
              <span>Company name</span>
              <input
                value={companyName}
                disabled={!canConfirm || confirming}
                onChange={(event) => setCompanyName(event.target.value)}
              />
            </label>
            <label>
              <span>Deal ownership</span>
              <select
                value={assignment}
                disabled={!canConfirm || confirming}
                onChange={(event) => setAssignment(event.target.value)}
              >
                {upload.candidateDeals.map((deal) => (
                  <option value={`existing:${deal.dealId}`} key={deal.dealId}>
                    Existing · {deal.companyName} · {deal.dealId}
                  </option>
                ))}
                <option value="new">Create a new Deal</option>
              </select>
            </label>
            {assignment === "new" && (
              <label>
                <span>New Deal status</span>
                <select
                  value={newDealStatus}
                  disabled={!canConfirm || confirming}
                  onChange={(event) =>
                    setNewDealStatus(event.target.value as DealStatus)}
                >
                  {[
                    "screening",
                    "watchlist",
                    "evaluating",
                    "passed",
                    "invested",
                  ].map((status) => (
                    <option value={status} key={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <label className="vsee-upload-ownership-check">
            <input
              type="checkbox"
              checked={ownershipConfirmed}
              disabled={!canConfirm || confirming}
              onChange={(event) => setOwnershipConfirmed(event.target.checked)}
            />
            <span>
              Confirm {companyName || "company"} and Deal ownership
            </span>
          </label>
          <footer>
            {!canConfirm && (
              <p role="status">
                Confirmation is disabled because the server did not grant
                source mutation.
              </p>
            )}
            <button
              className="primary"
              disabled={!canConfirm || !valid || confirming}
              onClick={confirm}
            >
              {confirming ? "CONFIRMING…" : "CONFIRM & PROMOTE"}
            </button>
          </footer>
        </section>
      )}

      {(upload.dealId || upload.sourceRevisionId) && (
        <dl className="vsee-upload-terminal-ids">
          <div>
            <dt>Deal ID</dt>
            <dd>{upload.dealId ?? "Pending"}</dd>
          </div>
          <div>
            <dt>Source Revision ID</dt>
            <dd>
              {upload.sourceRevisionId ? (
                <SourceRevisionLink revisionId={upload.sourceRevisionId}>
                  {upload.sourceRevisionId} ↗
                </SourceRevisionLink>
              ) : "Pending"}
            </dd>
          </div>
        </dl>
      )}
    </article>
  );
}
