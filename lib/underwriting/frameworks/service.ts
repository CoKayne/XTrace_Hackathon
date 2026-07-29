import { createHash } from "node:crypto";

import type { ClaudeClient } from "../../claude/client";
import {
  CalculationSchema,
  EvidencePackSchema,
  type Calculation,
  type EvidencePack,
} from "../../contracts/evidence";
import {
  CandidateRunSchema,
  ResolvedUnderwritingContextSchema,
  type CandidateRun,
  type FrameworkDisagreement,
  type FrameworkJudgment,
  type ResolvedUnderwritingContext,
} from "../../contracts/underwriting";
import { SYNTHETIC_FRAMEWORK_PACK } from "../../../seed/underwriting/framework-pack-v1";
import { runClaudeFrameworkLens } from "./claude-lens";
import { buildFrameworkDisagreements } from "./disagreements";
import {
  buildFrameworkAbstention,
  isExecutableFrameworkCard,
  isValuationFrameworkCard,
} from "./grounding";
import {
  FrameworkCardSchema,
  type FrameworkCard,
} from "./schemas";

export interface FrameworkLensExecutionSettings {
  provider: string;
  model: string;
  promptVersion: string;
  schemaVersion: string;
  settingsFingerprint: string;
  applicationCommit: string;
}

export interface FrameworkLensProviderMetadata
  extends FrameworkLensExecutionSettings {
  attempts: number;
  repaired: boolean;
}

export interface FrameworkLensCacheRecord {
  fingerprint: string;
  judgment: FrameworkJudgment;
  providerMetadata: FrameworkLensProviderMetadata;
}

export interface FrameworkLensCache {
  find(fingerprint: string): Promise<FrameworkLensCacheRecord | null>;
  save(record: FrameworkLensCacheRecord): Promise<void>;
}

export interface MemoryFrameworkLensCache extends FrameworkLensCache {
  inspect(): FrameworkLensCacheRecord[];
}

export interface FrameworkLensService {
  runAll(input: {
    candidate: CandidateRun;
    pack: EvidencePack;
    context: ResolvedUnderwritingContext;
    calculations: Calculation[];
  }): Promise<{
    judgments: FrameworkJudgment[];
    disagreements: FrameworkDisagreement[];
  }>;
}

export function createMemoryFrameworkLensCache(): MemoryFrameworkLensCache {
  const records = new Map<string, FrameworkLensCacheRecord>();
  return {
    async find(fingerprint) {
      const record = records.get(fingerprint);
      return record ? structuredClone(record) : null;
    },
    async save(record) {
      const existing = records.get(record.fingerprint);
      if (existing && canonicalJson(existing) !== canonicalJson(record)) {
        throw new Error(
          "A Framework lens fingerprint is immutable and already differs.",
        );
      }
      records.set(record.fingerprint, structuredClone(record));
    },
    inspect() {
      return [...records.values()]
        .sort((left, right) =>
          compareUtf8(left.fingerprint, right.fingerprint)
        )
        .map((record) => structuredClone(record));
    },
  };
}

export function createFrameworkLensService(options: {
  client: ClaudeClient;
  execution: FrameworkLensExecutionSettings;
  cards?: readonly FrameworkCard[];
  cache?: FrameworkLensCache;
  isApplicable?: (
    card: FrameworkCard,
    input: {
      pack: EvidencePack;
      context: ResolvedUnderwritingContext;
      calculations: Calculation[];
    },
  ) => boolean;
}): FrameworkLensService {
  const cards = (options.cards ?? SYNTHETIC_FRAMEWORK_PACK.cards)
    .map((card) => FrameworkCardSchema.parse(card));
  const cache = options.cache ?? createMemoryFrameworkLensCache();
  const execution = validateExecutionSettings(options.execution);

  return {
    async runAll(rawInput) {
      const candidate = CandidateRunSchema.parse(rawInput.candidate);
      const pack = EvidencePackSchema.parse(rawInput.pack);
      const context = ResolvedUnderwritingContextSchema.parse(
        rawInput.context,
      );
      const calculations = rawInput.calculations.map((item) =>
        CalculationSchema.parse(item)
      );
      if (
        candidate.workspaceId !== pack.workspaceId
        || candidate.dealId !== pack.dealId
        || context.asOfDate !== pack.asOfDate
      ) {
        throw new Error(
          "Framework lenses require one matching Candidate, Evidence Pack, and context.",
        );
      }

      const judgments: FrameworkJudgment[] = [];
      for (const card of cards) {
        const scopedCalculations = isValuationFrameworkCard(card)
          ? calculations
          : [];
        const fingerprint = createFrameworkLensFingerprint({
          pack,
          context,
          card,
          calculations: scopedCalculations,
          execution,
        });
        const replayed = await cache.find(fingerprint);
        if (replayed) {
          judgments.push(replayed.judgment);
          continue;
        }

        let judgment: FrameworkJudgment;
        let attempts = 0;
        let repaired = false;
        if (
          context.frameworkPackId !== SYNTHETIC_FRAMEWORK_PACK.id
          || !isExecutableFrameworkCard(card)
        ) {
          judgment = buildFrameworkAbstention({
            candidate,
            pack,
            card,
            calculations: scopedCalculations,
            fingerprint,
            applicability: "unavailable",
            reason:
              "Framework Card is not an executable published product-owned synthetic fixture.",
          });
        } else if (
          options.isApplicable
          && !options.isApplicable(card, { pack, context, calculations })
        ) {
          judgment = buildFrameworkAbstention({
            candidate,
            pack,
            card,
            calculations: scopedCalculations,
            fingerprint,
            applicability: "not_applicable",
            reason:
              "Framework Card is not applicable to this immutable context.",
          });
        } else {
          const result = await runClaudeFrameworkLens({
            client: options.client,
            candidate,
            pack,
            context,
            calculations: scopedCalculations,
            card,
            fingerprint,
          });
          judgment = result.judgment;
          attempts = result.attempts;
          repaired = result.repaired;
        }
        await cache.save({
          fingerprint,
          judgment,
          providerMetadata: {
            ...execution,
            attempts,
            repaired,
          },
        });
        judgments.push(judgment);
      }
      return {
        judgments,
        disagreements: buildFrameworkDisagreements({ judgments, cards }),
      };
    },
  };
}

function createFrameworkLensFingerprint(input: {
  pack: EvidencePack;
  context: ResolvedUnderwritingContext;
  card: FrameworkCard;
  calculations: Calculation[];
  execution: FrameworkLensExecutionSettings;
}): string {
  const canonical = canonicalJson({
    kind: "framework-lens-execution-v1",
    evidencePack: input.pack,
    card: input.card,
    context: input.context,
    calculations: input.calculations,
    provider: input.execution.provider,
    model: input.execution.model,
    promptVersion: input.execution.promptVersion,
    schemaVersion: input.execution.schemaVersion,
    settingsFingerprint: input.execution.settingsFingerprint,
    applicationCommit: input.execution.applicationCommit,
  });
  return `sha256:${
    createHash("sha256").update(canonical, "utf8").digest("hex")
  }`;
}

function validateExecutionSettings(
  input: FrameworkLensExecutionSettings,
): FrameworkLensExecutionSettings {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => {
      if (!value || value.trim() !== value) {
        throw new Error(
          `Framework lens execution ${key} must be non-empty without surrounding whitespace.`,
        );
      }
      return [key, value];
    }),
  ) as unknown as FrameworkLensExecutionSettings;
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Framework fingerprints require finite numbers.");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${
      Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort(compareUtf8)
        .map((key) =>
          `${JSON.stringify(key)}:${canonicalJson(record[key])}`
        )
        .join(",")
    }}`;
  }
  throw new Error(
    `Unsupported Framework fingerprint input: ${typeof value}.`,
  );
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
