import {
  FundPolicySnapshotSchema,
  ResolvedUnderwritingContextSchema,
  type FundPolicySnapshot,
  type ResolvedUnderwritingContext,
} from "../../lib/contracts/underwriting";
import {
  IntegrationTransportError,
  isRetryableTransportStatus,
} from "../../lib/api/errors";
import {
  BALANCED_POLICY_VALUES,
  type FundPolicyValues,
} from "../../seed/underwriting/balanced-policy-v1";
import {
  SYNTHETIC_FRAMEWORK_PACK,
  type SyntheticFrameworkPackFixture,
} from "../../seed/underwriting/framework-pack-v1";
import {
  SLICE_ONE_CONTEXTS,
  type SliceOneBusinessModel,
  type SliceOneGeography,
  type SliceOneStage,
} from "../../seed/underwriting/slice-one-contexts-v1";

export interface ContextKey {
  stage: SliceOneStage;
  businessModel: SliceOneBusinessModel;
  geography: SliceOneGeography;
  securityType: "preferred";
  asOfDate: string;
}

type PolicyFieldValue = string | string[] | boolean | null;

export interface PolicyFieldDiff {
  field: string;
  previousValue: PolicyFieldValue;
  recommendedValue: PolicyFieldValue;
  source: "recommended_policy";
}

export interface SaveCustomPolicyInput {
  workspaceId: string;
  actorId: string;
  expectedActiveVersionId: string | null;
  values: FundPolicyValues;
}

export interface UnderwritingReferencesRepository {
  activeFundPolicy(workspaceId: string): Promise<FundPolicySnapshot>;
  saveCustomPolicy(input: SaveCustomPolicyInput): Promise<FundPolicySnapshot>;
  applyBalancedDefaults(input: {
    workspaceId: string;
    actorId: string;
    expectedActiveVersionId: string | null;
  }): Promise<{
    snapshot: FundPolicySnapshot;
    overwrittenDiff: PolicyFieldDiff[];
  }>;
  restorePolicyVersion(input: {
    workspaceId: string;
    actorId: string;
    versionId: string;
  }): Promise<FundPolicySnapshot>;
  listFundPolicyVersions(
    workspaceId: string,
  ): Promise<FundPolicySnapshot[]>;
  resolveContext(input: ContextKey): Promise<
    | { kind: "resolved"; value: ResolvedUnderwritingContext }
    | {
      kind: "needs_confirmation";
      fields: Array<
        "stage" | "businessModel" | "geography" | "securityType"
      >;
    }
    | { kind: "unsupported"; reason: string }
  >;
  getFrameworkPack(
    id: string,
  ): Promise<SyntheticFrameworkPackFixture | null>;
}

export interface MemoryUnderwritingReferencesRepository
  extends UnderwritingReferencesRepository {
  inspect(): {
    policyVersions: FundPolicySnapshot[];
  };
}

const UNSUPPORTED_CONTEXT_REASON =
  "Vertical Slice 1 supports only Seed or Series A B2B SaaS or Enterprise AI preferred-equity contexts.";

export function createMemoryUnderwritingReferencesRepository(options: {
  now?: () => Date;
} = {}): MemoryUnderwritingReferencesRepository {
  const now = options.now ?? (() => new Date());
  const policyVersions = new Map<string, FundPolicySnapshot[]>();
  const activePolicyIds = new Map<string, string>();

  function versionsFor(workspaceId: string): FundPolicySnapshot[] {
    const normalizedWorkspaceId = requiredText(workspaceId, "A workspace");
    let versions = policyVersions.get(normalizedWorkspaceId);
    if (!versions) {
      versions = [];
      policyVersions.set(normalizedWorkspaceId, versions);
    }
    return versions;
  }

  function appendPolicy(input: {
    workspaceId: string;
    actorId: string | null;
    source: FundPolicySnapshot["source"];
    values: FundPolicyValues;
  }): FundPolicySnapshot {
    const workspaceId = requiredText(input.workspaceId, "A workspace");
    const versions = versionsFor(workspaceId);
    const version = versions.length + 1;
    const snapshot = FundPolicySnapshotSchema.parse({
      id: `fund_policy:${workspaceId}:v${version}`,
      workspaceId,
      version,
      source: input.source,
      values: structuredClone(input.values),
      createdByUserId: input.actorId,
      createdAt: now().toISOString(),
    });
    versions.push(snapshot);
    activePolicyIds.set(workspaceId, snapshot.id);
    return cloneSnapshot(snapshot);
  }

  function getActiveOrCreate(workspaceId: string): FundPolicySnapshot {
    const normalizedWorkspaceId = requiredText(workspaceId, "A workspace");
    const versions = versionsFor(normalizedWorkspaceId);
    const activeId = activePolicyIds.get(normalizedWorkspaceId);
    const active = activeId
      ? versions.find((snapshot) => snapshot.id === activeId)
      : undefined;
    return active
      ? cloneSnapshot(active)
      : appendPolicy({
        workspaceId: normalizedWorkspaceId,
        actorId: null,
        source: "recommended_policy",
        values: BALANCED_POLICY_VALUES,
      });
  }

  function assertExpectedActive(
    workspaceId: string,
    expectedActiveVersionId: string | null,
  ): FundPolicySnapshot {
    const active = getActiveOrCreate(workspaceId);
    if (active.id !== expectedActiveVersionId) {
      throw new Error("FUND_POLICY_VERSION_CONFLICT");
    }
    return active;
  }

  return {
    async activeFundPolicy(workspaceId) {
      return getActiveOrCreate(workspaceId);
    },

    async saveCustomPolicy(input) {
      const workspaceId = requiredText(input.workspaceId, "A workspace");
      assertExpectedActive(workspaceId, input.expectedActiveVersionId);
      return appendPolicy({
        workspaceId,
        actorId: requiredText(input.actorId, "An actor"),
        source: "user_custom",
        values: structuredClone(input.values),
      });
    },

    async applyBalancedDefaults(input) {
      const workspaceId = requiredText(input.workspaceId, "A workspace");
      const active = assertExpectedActive(
        workspaceId,
        input.expectedActiveVersionId,
      );
      const overwrittenDiff = policyDiff(
        active.values as unknown as FundPolicyValues,
        BALANCED_POLICY_VALUES,
      );
      return {
        snapshot: appendPolicy({
          workspaceId,
          actorId: requiredText(input.actorId, "An actor"),
          source: "recommended_policy",
          values: BALANCED_POLICY_VALUES,
        }),
        overwrittenDiff,
      };
    },

    async restorePolicyVersion(input) {
      const workspaceId = requiredText(input.workspaceId, "A workspace");
      const versionId = requiredText(input.versionId, "A policy version");
      getActiveOrCreate(workspaceId);
      const target = versionsFor(workspaceId).find(
        (snapshot) => snapshot.id === versionId,
      );
      if (!target) throw new Error("FUND_POLICY_VERSION_NOT_FOUND");
      return appendPolicy({
        workspaceId,
        actorId: requiredText(input.actorId, "An actor"),
        source: target.source,
        values: target.values as unknown as FundPolicyValues,
      });
    },

    async listFundPolicyVersions(workspaceId) {
      getActiveOrCreate(workspaceId);
      return versionsFor(workspaceId)
        .map(cloneSnapshot)
        .sort((left, right) => right.version - left.version);
    },

    async resolveContext(input) {
      const missing = (
        ["stage", "businessModel", "geography", "securityType"] as const
      ).filter((field) => !input?.[field]);
      if (missing.length > 0) {
        return { kind: "needs_confirmation", fields: missing };
      }
      if (
        !["seed", "series_a"].includes(input.stage)
        || !["b2b_saas", "enterprise_ai"].includes(input.businessModel)
        || !["us", "global"].includes(input.geography)
        || input.securityType !== "preferred"
        || !isIsoDate(input.asOfDate)
      ) {
        return { kind: "unsupported", reason: UNSUPPORTED_CONTEXT_REASON };
      }
      const profile = SLICE_ONE_CONTEXTS.find(
        (candidate) =>
          candidate.stage === input.stage
          && candidate.businessModel === input.businessModel,
      );
      if (!profile) {
        return { kind: "unsupported", reason: UNSUPPORTED_CONTEXT_REASON };
      }
      const benchmarkAvailable = input.geography === "us";
      return {
        kind: "resolved",
        value: ResolvedUnderwritingContextSchema.parse({
          id:
            `${profile.id}:${input.geography}:preferred:${input.asOfDate}`,
          contextVersion: profile.contextVersion,
          stage: input.stage,
          businessModel: input.businessModel,
          geography: input.geography,
          securityType: input.securityType,
          asOfDate: input.asOfDate,
          criticalEvidenceProfileId: profile.criticalEvidenceProfileId,
          benchmarkPackId: benchmarkAvailable
            ? profile.usBenchmarkPackId
            : null,
          benchmarkCompatibility: benchmarkAvailable
            ? profile.usBenchmarkCompatibility
            : "unavailable",
          valuationMethodPolicyId: profile.valuationMethodPolicyId,
          decisionPolicyId: profile.decisionPolicyId,
          frameworkPackId: profile.frameworkPackId,
        }),
      };
    },

    async getFrameworkPack(id) {
      return id === SYNTHETIC_FRAMEWORK_PACK.id
        ? structuredClone(SYNTHETIC_FRAMEWORK_PACK)
        : null;
    },

    inspect() {
      return {
        policyVersions: [...policyVersions.values()]
          .flat()
          .map(cloneSnapshot),
      };
    },
  };
}

export function createSupabaseUnderwritingReferencesRepository(options: {
  url: string;
  serviceRoleKey: string;
  fetchImpl?: typeof fetch;
}): UnderwritingReferencesRepository {
  const base = `${options.url.replace(/\/$/, "")}/rest/v1`;
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers = {
    apikey: options.serviceRoleKey,
    authorization: `Bearer ${options.serviceRoleKey}`,
    "content-type": "application/json",
  };

  async function request(path: string, init: RequestInit = {}): Promise<unknown> {
    let response: Response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        ...init,
        headers: { ...headers, ...(init.headers ?? {}) },
        cache: "no-store",
      });
    } catch {
      throw new IntegrationTransportError({ retryable: true });
    }
    const text = await response.text();
    if (!response.ok) {
      if (text.includes("FUND_POLICY_VERSION_CONFLICT")) {
        throw new Error("FUND_POLICY_VERSION_CONFLICT");
      }
      if (text.includes("FUND_POLICY_VERSION_NOT_FOUND")) {
        throw new Error("FUND_POLICY_VERSION_NOT_FOUND");
      }
      throw new IntegrationTransportError({
        retryable: isRetryableTransportStatus(response.status),
      });
    }
    return text ? JSON.parse(text) : null;
  }

  async function activate(requestBody: Record<string, unknown>) {
    const payload = await request("/rpc/activate_fund_policy_version", {
      method: "POST",
      body: JSON.stringify({ p_request: requestBody }),
    });
    return parseSnapshot(payload);
  }

  async function activeFundPolicy(
    workspaceId: string,
  ): Promise<FundPolicySnapshot> {
    workspaceId = requiredText(workspaceId, "A workspace");
    const pointers = await request(
      `/workspace_active_fund_policies?workspace_id=eq.${
        encodeURIComponent(workspaceId)
      }&select=version_id&limit=1`,
    ) as Array<Record<string, unknown>>;
    const versionId = pointers[0]?.version_id;
    if (typeof versionId !== "string") {
      return activate({
        workspaceId,
        actorId: null,
        expectedActiveVersionId: null,
        action: "recommended",
      });
    }
    const rows = await request(
      `/fund_policy_versions?workspace_id=eq.${
        encodeURIComponent(workspaceId)
      }&id=eq.${encodeURIComponent(versionId)}&limit=1`,
    ) as Array<Record<string, unknown>>;
    if (!rows[0]) {
      throw new IntegrationTransportError({ retryable: false });
    }
    return parseSnapshot(rows[0]);
  }

  return {
    activeFundPolicy,

    saveCustomPolicy(input) {
      return activate({
        workspaceId: requiredText(input.workspaceId, "A workspace"),
        actorId: requiredText(input.actorId, "An actor"),
        expectedActiveVersionId: input.expectedActiveVersionId,
        action: "custom",
        values: structuredClone(input.values),
      });
    },

    async applyBalancedDefaults(input) {
      const active = await activeFundPolicy(input.workspaceId);
      if (active.id !== input.expectedActiveVersionId) {
        throw new Error("FUND_POLICY_VERSION_CONFLICT");
      }
      return {
        snapshot: await activate({
          workspaceId: requiredText(input.workspaceId, "A workspace"),
          actorId: requiredText(input.actorId, "An actor"),
          expectedActiveVersionId: input.expectedActiveVersionId,
          action: "recommended",
        }),
        overwrittenDiff: policyDiff(
          active.values as unknown as FundPolicyValues,
          BALANCED_POLICY_VALUES,
        ),
      };
    },

    async restorePolicyVersion(input) {
      const active = await activeFundPolicy(input.workspaceId);
      return activate({
        workspaceId: requiredText(input.workspaceId, "A workspace"),
        actorId: requiredText(input.actorId, "An actor"),
        expectedActiveVersionId: active.id,
        action: "restore",
        versionId: requiredText(input.versionId, "A policy version"),
      });
    },

    async listFundPolicyVersions(workspaceId) {
      workspaceId = requiredText(workspaceId, "A workspace");
      const rows = await request(
        `/fund_policy_versions?workspace_id=eq.${
          encodeURIComponent(workspaceId)
        }&order=version.desc`,
      ) as Array<Record<string, unknown>>;
      if (rows.length === 0) {
        return [await activeFundPolicy(workspaceId)];
      }
      return rows.map(parseSnapshot);
    },

    async resolveContext(input) {
      const missing = (
        ["stage", "businessModel", "geography", "securityType"] as const
      ).filter((field) => !input?.[field]);
      if (missing.length > 0) {
        return { kind: "needs_confirmation", fields: missing };
      }
      if (
        !["seed", "series_a"].includes(input.stage)
        || !["b2b_saas", "enterprise_ai"].includes(input.businessModel)
        || !["us", "global"].includes(input.geography)
        || input.securityType !== "preferred"
        || !isIsoDate(input.asOfDate)
      ) {
        return { kind: "unsupported", reason: UNSUPPORTED_CONTEXT_REASON };
      }
      const pinnedProfile = SLICE_ONE_CONTEXTS.find(
        (candidate) =>
          candidate.stage === input.stage
          && candidate.businessModel === input.businessModel,
      );
      if (!pinnedProfile) {
        return { kind: "unsupported", reason: UNSUPPORTED_CONTEXT_REASON };
      }
      const rows = await request(
        `/underwriting_contexts?id=eq.${encodeURIComponent(pinnedProfile.id)}`
          + `&context_version=eq.${
            encodeURIComponent(pinnedProfile.contextVersion)
          }`
          + `&stage=eq.${encodeURIComponent(input.stage)}`
          + `&business_model=eq.${encodeURIComponent(input.businessModel)}`
          + "&publication_status=eq.published",
      ) as Array<Record<string, unknown>>;
      const row = rows.find((candidate) =>
        candidate.id === pinnedProfile.id
        && candidate.context_version === pinnedProfile.contextVersion
      );
      if (!row) {
        return { kind: "unsupported", reason: UNSUPPORTED_CONTEXT_REASON };
      }
      const us = input.geography === "us";
      return {
        kind: "resolved",
        value: ResolvedUnderwritingContextSchema.parse({
          id: `${String(row.id)}:${input.geography}:preferred:${input.asOfDate}`,
          contextVersion: row.context_version,
          stage: input.stage,
          businessModel: input.businessModel,
          geography: input.geography,
          securityType: input.securityType,
          asOfDate: input.asOfDate,
          criticalEvidenceProfileId: row.critical_evidence_profile_id,
          benchmarkPackId: us ? row.us_benchmark_pack_id : null,
          benchmarkCompatibility: us
            ? row.us_benchmark_compatibility
            : row.global_benchmark_compatibility,
          valuationMethodPolicyId: row.valuation_method_policy_id,
          decisionPolicyId: row.decision_policy_id,
          frameworkPackId: row.framework_pack_id,
        }),
      };
    },

    async getFrameworkPack(id) {
      id = requiredText(id, "A framework pack");
      const packs = await request(
        `/framework_packs?id=eq.${encodeURIComponent(id)}`
          + "&publication_status=eq.published&limit=1",
      ) as Array<Record<string, unknown>>;
      const pack = packs[0];
      if (
        !pack
        || pack.synthetic !== true
        || pack.publication_status !== "published"
      ) {
        return null;
      }
      const joins = await request(
        `/framework_pack_cards?framework_pack_id=eq.${encodeURIComponent(id)}`
          + "&select=position,framework_cards!inner("
          + "id,version,title,synthetic,publication_status,attribution,"
          + "approved_neutral_paraphrase,locator,limitations,rights_status,"
          + "formal_decision_weight)"
          + "&framework_cards.synthetic=eq.true"
          + "&framework_cards.publication_status=eq.published"
          + "&order=position.asc",
      ) as Array<Record<string, unknown>>;
      const publishedCards = joins
        .map((join) => join.framework_cards as Record<string, unknown>)
        .filter((card) =>
          card.synthetic === true
          && card.publication_status === "published"
          && card.attribution === "Product-owned synthetic fixture"
          && card.rights_status === "product_owned_synthetic"
          && String(card.formal_decision_weight) === "0"
        );
      return {
        id: String(pack.id),
        version: String(pack.version),
        title: String(pack.title),
        synthetic: true,
        publicationStatus: "published",
        cards: publishedCards.map((card) => {
          return {
            id: String(card.id),
            version: String(card.version),
            title: String(card.title),
            synthetic: true,
            publicationStatus: "published",
            attribution: "Product-owned synthetic fixture",
            approvedNeutralParaphrase: String(
              card.approved_neutral_paraphrase,
            ),
            locator: String(card.locator),
            limitations: Array.isArray(card.limitations)
              ? card.limitations.map(String)
              : [],
            rightsStatus: "product_owned_synthetic",
            formalDecisionWeight: "0",
          };
        }),
      };
    },
  };
}

let singleton: UnderwritingReferencesRepository | undefined;

export function getUnderwritingReferencesRepository(): UnderwritingReferencesRepository {
  if (!singleton) {
    const url = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    singleton = url && serviceRoleKey
      ? createSupabaseUnderwritingReferencesRepository({
        url,
        serviceRoleKey,
      })
      : createMemoryUnderwritingReferencesRepository();
  }
  return singleton;
}

function requiredText(value: string, label: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function cloneSnapshot(snapshot: FundPolicySnapshot): FundPolicySnapshot {
  return structuredClone(snapshot);
}

function parseSnapshot(value: unknown): FundPolicySnapshot {
  const row = value as Record<string, unknown>;
  return FundPolicySnapshotSchema.parse({
    id: row.id,
    workspaceId: row.workspaceId ?? row.workspace_id,
    version: row.version,
    source: row.source,
    values: row.values,
    createdByUserId:
      row.createdByUserId ?? row.created_by_user_id ?? null,
    createdAt: row.createdAt ?? row.created_at,
  });
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`));
}

function policyDiff(
  previous: FundPolicyValues,
  recommended: FundPolicyValues,
): PolicyFieldDiff[] {
  const previousLeaves = flattenPolicy(previous);
  const recommendedLeaves = flattenPolicy(recommended);
  return [...recommendedLeaves.entries()]
    .filter(([field, value]) =>
      JSON.stringify(previousLeaves.get(field)) !== JSON.stringify(value)
    )
    .map(([field, recommendedValue]) => ({
      field,
      previousValue: previousLeaves.get(field) ?? null,
      recommendedValue,
      source: "recommended_policy" as const,
    }))
    .sort((left, right) => left.field.localeCompare(right.field));
}

function flattenPolicy(
  value: object,
  prefix = "",
): Map<string, PolicyFieldValue> {
  const leaves = new Map<string, PolicyFieldValue>();
  for (const [key, item] of Object.entries(value)) {
    const field = prefix ? `${prefix}.${key}` : key;
    if (
      item === null
      || typeof item === "string"
      || typeof item === "boolean"
      || (
        Array.isArray(item)
        && item.every((entry) => typeof entry === "string")
      )
    ) {
      leaves.set(field, item as PolicyFieldValue);
      continue;
    }
    if (typeof item === "object" && !Array.isArray(item)) {
      for (const [nestedField, nestedValue] of flattenPolicy(
        item,
        field,
      )) {
        leaves.set(nestedField, nestedValue);
      }
    }
  }
  return leaves;
}
