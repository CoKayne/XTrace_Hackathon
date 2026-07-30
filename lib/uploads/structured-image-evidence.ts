import type { DealFact } from "../contracts/domain";

export interface CanonicalStructuredImageEvidence {
  id: string;
  workspaceId: string;
  dealId: string;
  sourceId: string;
  sourceRevisionId: string;
  provenanceOrigin: string;
  field: string;
  value: string;
  unit: string | null;
  currency: string | null;
  locator: unknown;
  acceptedForGate: boolean;
}

export const STRUCTURED_IMAGE_EVIDENCE_PREFIX =
  "Structured image evidence (not a quotation):";

export function structuredImageDealFact(input: {
  evidence: CanonicalStructuredImageEvidence;
  title: string;
}): DealFact | null {
  const evidence = input.evidence;
  if (
    evidence.provenanceOrigin !== "uploaded_document"
    || evidence.acceptedForGate !== true
    || evidence.field.trim() === ""
    || evidence.field === "unstructured_source_fact"
    || evidence.value.trim() === ""
    || !isImageLocator(evidence.locator)
  ) {
    return null;
  }
  const suffix = [
    evidence.unit && evidence.unit.toLowerCase() !== "currency"
      ? evidence.unit
      : null,
    evidence.currency,
  ].filter((value): value is string => Boolean(value?.trim()));
  const text = [
    STRUCTURED_IMAGE_EVIDENCE_PREFIX,
    `${evidence.field} = ${evidence.value}${
      suffix.length ? ` ${suffix.join(" ")}` : ""
    }.`,
  ].join(" ");
  return {
    text,
    sources: [{
      id: evidence.id,
      provenance: "model_inference",
      title: input.title,
      documentId: evidence.sourceId,
      sourceRevisionId: evidence.sourceRevisionId,
      excerpt: text,
    }],
  };
}

function isImageLocator(
  locator: unknown,
): locator is { kind: "image"; imageIndex: number } {
  return Boolean(
    locator
    && typeof locator === "object"
    && "kind" in locator
    && locator.kind === "image"
    && "imageIndex" in locator
    && Number.isInteger(locator.imageIndex)
    && Number(locator.imageIndex) >= 0,
  );
}
