"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import type { FundPolicySnapshot } from "../lib/contracts/underwriting";
import {
  BALANCED_POLICY_VALUES,
  type FundPolicyValues,
} from "../seed/underwriting/balanced-policy-v1";
import { apiRequest } from "./api-client";

type PolicyLeaf = string | string[] | boolean | null;

interface PolicyDiff {
  field: string;
  previousValue: PolicyLeaf;
  recommendedValue: PolicyLeaf;
}

export function FundPolicyView({ canManage }: { canManage: boolean }) {
  const [policy, setPolicy] = useState<FundPolicySnapshot | null>(null);
  const [versions, setVersions] = useState<FundPolicySnapshot[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const [active, history] = await Promise.all([
        apiRequest<FundPolicySnapshot>("/api/fund-policy"),
        apiRequest<FundPolicySnapshot[]>("/api/fund-policy/versions"),
      ]);
      setPolicy(active);
      setVersions(history);
      setError("");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Fund Policy could not be loaded.",
      );
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function applyRecommended() {
    if (!policy || !canManage) return;
    setApplying(true);
    setError("");
    try {
      const result = await apiRequest<{
        snapshot: FundPolicySnapshot;
        overwrittenDiff: PolicyDiff[];
      }>("/api/fund-policy/apply-recommended", {
        method: "POST",
        body: JSON.stringify({ expectedActiveVersionId: policy.id }),
      });
      setPolicy(result.snapshot);
      setPreviewOpen(false);
      setNotice(
        `Fund Policy version ${result.snapshot.version} appended. `
        + `${result.overwrittenDiff.length} field`
        + `${result.overwrittenDiff.length === 1 ? "" : "s"} overwritten.`,
      );
      const history = await apiRequest<FundPolicySnapshot[]>(
        "/api/fund-policy/versions",
      );
      setVersions(history);
    } catch (applyError) {
      setError(
        applyError instanceof Error
          ? applyError.message
          : "Recommended defaults could not be applied.",
      );
    } finally {
      setApplying(false);
    }
  }

  if (!policy) {
    return (
      <div className="vsee-content">
        <header className="vsee-section-title">
          <span className="vsee-eyebrow">IMMUTABLE INVESTMENT RULES</span>
          <h1>Fund Policy</h1>
          <p>{error || "Loading the active Fund Policy…"}</p>
        </header>
      </div>
    );
  }

  return (
    <div className="vsee-content">
      {error && <p className="vsee-inline-error" role="alert">{error}</p>}
      {notice && <p className="vsee-inline-notice" role="status">{notice}</p>}
      <FundPolicyPanel
        policy={policy}
        versions={versions}
        canManage={canManage}
        previewOpen={previewOpen}
        applying={applying}
        onOpenPreview={() => setPreviewOpen(true)}
        onClosePreview={() => setPreviewOpen(false)}
        onApplyRecommended={() => void applyRecommended()}
      />
    </div>
  );
}

export function FundPolicyPanel({
  policy,
  versions = [],
  canManage,
  previewOpen,
  applying,
  onOpenPreview,
  onClosePreview,
  onApplyRecommended,
}: {
  policy: FundPolicySnapshot;
  versions?: FundPolicySnapshot[];
  canManage: boolean;
  previewOpen: boolean;
  applying: boolean;
  onOpenPreview(): void;
  onClosePreview(): void;
  onApplyRecommended(): void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const values = policy.values as unknown as FundPolicyValues;
  const diff = recommendedPolicyDiff(values);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (previewOpen && !dialog.open) dialog.showModal();
    if (!previewOpen && dialog.open) dialog.close();
  }, [previewOpen]);

  return (
    <>
      <header className="vsee-section-title">
        <span className="vsee-eyebrow">IMMUTABLE INVESTMENT RULES</span>
        <h1>Fund Policy · Version {policy.version}</h1>
        <p>
          This snapshot governs new underwriting runs. Existing reports retain
          the exact policy version that produced them.
        </p>
      </header>

      <section className="vsee-policy-hero vsee-panel">
        <header>
          <span>
            {policy.source === "recommended_policy"
              ? "RECOMMENDED POLICY"
              : "USER-CUSTOM POLICY"}
          </span>
          <button onClick={onOpenPreview}>
            APPLY RECOMMENDED DEFAULTS
          </button>
        </header>
        <div className="vsee-policy-summary">
          <PolicyValue label="Risk preference" value={values.riskPreference} />
          <PolicyValue
            label="Fund size"
            value={formatMoney(values.committedFundSize, values.baseCurrency)}
          />
          <PolicyValue
            label="Deployable capital"
            value={formatMoney(
              values.remainingDeployableCapital,
              values.baseCurrency,
            )}
          />
          <PolicyValue
            label="Initial check"
            value={`${formatMoney(values.initialCheckMin, values.baseCurrency)}
              – ${formatMoney(values.initialCheckMax, values.baseCurrency)}`}
          />
          <PolicyValue
            label="Target ownership"
            value={formatPercent(values.targetOwnership)}
          />
          <PolicyValue
            label="Concentration limit"
            value={formatPercent(values.portfolioConcentrationLimit)}
          />
        </div>
      </section>

      <div className="vsee-policy-grid">
        <PolicyGroup
          title="Mandate"
          rows={[
            ["Stages", values.stageMandate],
            ["Business models", values.businessModelMandate],
            ["Geographies", values.geographyMandate],
            ["External action", values.externalActionMode],
          ]}
        />
        <PolicyGroup
          title="Ownership & reserves"
          rows={[
            ["Target ownership minimum", formatPercent(values.targetOwnershipMin)],
            ["Target ownership maximum", formatPercent(values.targetOwnershipMax)],
            [
              "Hard minimum ownership",
              values.hardMinimumOwnership
                ? formatPercent(values.hardMinimumOwnership)
                : "No hard minimum",
            ],
            ["Reserve multiple", `${values.reserveMultipleOfInitialCheck}×`],
          ]}
        />
        <PolicyGroup
          title="Return assumptions"
          rows={[
            ["Seed gross MOIC", `${values.returnTargets.seed.grossMoic}×`],
            ["Seed gross IRR", formatPercent(values.returnTargets.seed.grossIrr)],
            ["Series A gross MOIC", `${values.returnTargets.series_a.grossMoic}×`],
            [
              "Series A gross IRR",
              formatPercent(values.returnTargets.series_a.grossIrr),
            ],
          ]}
        />
        <PolicyGroup
          title="Limits"
          rows={[
            [
              "Valuation review premium",
              formatPercent(values.valuationPremiumReviewThreshold),
            ],
            [
              "Valuation blocker premium",
              formatPercent(values.valuationPremiumBlockerThreshold),
            ],
            [
              "Acceptable future dilution",
              formatPercent(values.acceptableFutureDilution),
            ],
            [
              "Human final approval",
              values.humanFinalApproval ? "Required" : "Not required",
            ],
          ]}
        />
      </div>

      <section className="vsee-policy-versions" aria-labelledby="policy-history">
        <header>
          <span className="vsee-eyebrow">APPEND-ONLY HISTORY</span>
          <h2 id="policy-history">Policy versions</h2>
        </header>
        <div>
          {(versions.length ? versions : [policy]).map((version) => (
            <article key={version.id}>
              <strong>Version {version.version}</strong>
              <span>{version.source.replace("_", " ")}</span>
              <time>{formatDate(version.createdAt)}</time>
              <small>{version.id}</small>
            </article>
          ))}
        </div>
      </section>

      <dialog
        className="vsee-policy-dialog"
        ref={dialogRef}
        aria-labelledby="policy-preview-title"
        onClose={onClosePreview}
      >
        <div>
          <header>
            <div>
              <span className="vsee-eyebrow">OVERWRITE PREVIEW</span>
              <h2 id="policy-preview-title">Apply Recommended Defaults</h2>
              <p>
                Confirmation appends a new immutable version. It never rewrites
                the policy pinned to an existing report.
              </p>
            </div>
            <button onClick={onClosePreview} aria-label="Close policy preview">
              ×
            </button>
          </header>
          <div className="vsee-policy-diff">
            {diff.length ? diff.map((item) => (
              <article key={item.field}>
                <strong>{humanize(item.field)}</strong>
                <span>{formatPolicyValue(item.previousValue, item.field)}</span>
                <b aria-hidden="true">→</b>
                <span>
                  {formatPolicyValue(item.recommendedValue, item.field)}
                </span>
              </article>
            )) : (
              <p role="status">
                The active policy already matches every recommended default.
              </p>
            )}
          </div>
          <footer>
            {!canManage && (
              <p>
                Policy changes are disabled in this read-only public demo.
              </p>
            )}
            <button onClick={onClosePreview}>CANCEL</button>
            <button
              className="primary"
              onClick={onApplyRecommended}
              disabled={!canManage || applying}
              title={!canManage
                ? "The server did not grant Fund Policy management."
                : undefined}
            >
              {applying ? "APPENDING VERSION…" : "CONFIRM & APPEND VERSION"}
            </button>
          </footer>
        </div>
      </dialog>
    </>
  );
}

function PolicyValue({ label, value }: { label: string; value: string }) {
  return (
    <article>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function PolicyGroup({
  title,
  rows,
}: {
  title: string;
  rows: Array<[string, string | string[]]>;
}) {
  return (
    <section className="vsee-panel vsee-policy-group">
      <header><span>{title}</span></header>
      <dl>
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{Array.isArray(value) ? value.join(" · ") : value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function recommendedPolicyDiff(values: FundPolicyValues): PolicyDiff[] {
  const current = flattenPolicy(values);
  const recommended = flattenPolicy(BALANCED_POLICY_VALUES);
  return [...recommended.entries()]
    .filter(([field, value]) =>
      JSON.stringify(current.get(field)) !== JSON.stringify(value)
    )
    .map(([field, recommendedValue]) => ({
      field,
      previousValue: current.get(field) ?? null,
      recommendedValue,
    }))
    .sort((left, right) => left.field.localeCompare(right.field));
}

function flattenPolicy(value: object, prefix = ""): Map<string, PolicyLeaf> {
  const leaves = new Map<string, PolicyLeaf>();
  for (const [key, item] of Object.entries(value)) {
    const field = prefix ? `${prefix}.${key}` : key;
    if (
      item === null
      || typeof item === "string"
      || typeof item === "boolean"
      || (Array.isArray(item) && item.every((entry) => typeof entry === "string"))
    ) {
      leaves.set(field, item as PolicyLeaf);
    } else if (typeof item === "object") {
      for (const [nested, nestedValue] of flattenPolicy(item, field)) {
        leaves.set(nested, nestedValue);
      }
    }
  }
  return leaves;
}

function formatPolicyValue(value: PolicyLeaf, field: string): string {
  if (value === null) return "None";
  if (Array.isArray(value)) return value.join(" · ");
  if (typeof value === "boolean") return value ? "Required" : "Not required";
  if (
    /fundSize|Capital|CheckMin|CheckMax/.test(field)
  ) return formatMoney(value, "USD");
  if (
    /Ownership|Concentration|Irr|Premium|Dilution|Multiplier/.test(field)
  ) return formatPercent(value);
  return value;
}

function formatMoney(value: string, currency: string): string {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      }).format(numeric)
    : value;
}

function formatPercent(value: string): string {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? new Intl.NumberFormat("en-US", {
        style: "percent",
        maximumFractionDigits: 1,
      }).format(numeric)
    : value;
}

function humanize(value: string): string {
  return value
    .replaceAll(".", " · ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}
