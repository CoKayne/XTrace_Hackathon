import type {
  FrameworkAdvisoryMetadata,
  FrameworkDisagreement,
  FrameworkJudgment,
} from "../contracts/underwriting";

type AdvisoryJudgment = FrameworkJudgment & {
  frameworkMetadata: FrameworkAdvisoryMetadata;
};

export function renderExperimentalAdvisoryOpinions(
  judgments: FrameworkJudgment[],
): string {
  const advisoryJudgments = judgments.filter(isAdvisoryJudgment);
  if (advisoryJudgments.length === 0) return "Unavailable";
  return advisoryJudgments.map(renderAdvisoryJudgment).join("\n");
}

export function renderIndependentAdvisoryConflicts(
  disagreements: FrameworkDisagreement[],
  judgments: FrameworkJudgment[],
): string {
  const judgmentsById = new Map(
    judgments.filter(isAdvisoryJudgment).map((judgment) => [
      judgment.id,
      judgment,
    ]),
  );
  const conflicts = disagreements.flatMap((disagreement) => {
    if (disagreement.topic !== "independent_framework_conflict") return [];
    const left = judgmentsById.get(disagreement.leftJudgmentId);
    const right = judgmentsById.get(disagreement.rightJudgmentId);
    return left && right ? [{ disagreement, left, right }] : [];
  });
  if (conflicts.length === 0) return "Unavailable";
  return conflicts.map(({ disagreement, left, right }) => [
    `- ${namedConclusion(left)} versus ${namedConclusion(right)}`,
    `  Explanation: ${disagreement.explanation}`,
    `  Evidence: ${inlineList(disagreement.evidenceItemIds)}`,
  ].join("\n")).join("\n");
}

export function renderAdvisoryDiligenceRequests(
  judgments: FrameworkJudgment[],
): string {
  const requests = judgments.filter(isAdvisoryJudgment).flatMap((judgment) => {
    const packName = judgment.frameworkMetadata.packName;
    const unknownRequests = judgment.unknowns.map(
      (unknown) =>
        `- Resolve advisory unknown [${packName}]: ${unknown}`,
    );
    const counterevidenceRequests = judgment.strongestCounterargument
      ? [
        [
          `- Test advisory counterevidence [${packName}]:`,
          judgment.strongestCounterargument,
          `(evidence IDs: ${inlineList(judgment.counterEvidenceItemIds)})`,
        ].join(" "),
      ]
      : judgment.counterEvidenceItemIds.length > 0
      ? [
        `- Test advisory counterevidence [${packName}] (evidence IDs: ${
          inlineList(judgment.counterEvidenceItemIds)
        })`,
      ]
      : [];
    const limitationRequests = judgment.limitations.map(
      (limitation) =>
        `- Address advisory limitation [${packName}]: ${limitation}`,
    );
    return [
      ...unknownRequests,
      ...counterevidenceRequests,
      ...limitationRequests,
    ];
  });
  return requests.length === 0 ? "None" : requests.join("\n");
}

function renderAdvisoryJudgment(judgment: AdvisoryJudgment): string {
  const metadata = judgment.frameworkMetadata;
  return [
    `- Pack: ${metadata.packName}`,
    `  Pack ID: ${metadata.packId}; version: ${metadata.packVersion}`,
    `  Source catalog ID: ${metadata.sourceCatalogId}; research cutoff: ${metadata.researchCutoff}`,
    `  Attribution: ${componentAttributions(metadata)}`,
    "  Formal decision weight: 0 (experimental advisory; not a published formal decision factor)",
    `  Product-synthesis notice: ${metadata.notices.experimentalOnly}`,
    `  No-endorsement notice: ${metadata.notices.noEndorsement}`,
    `  No-private-reasoning notice: ${metadata.notices.noPrivateReasoning}`,
    `  Applicability: ${judgment.applicability}; advisory conclusion: ${judgment.conclusion}`,
    `  Advisory support: ${judgment.strongestSupport ?? "Unavailable"}`,
    `  Advisory counterevidence: ${
      judgment.strongestCounterargument ?? "Unavailable"
    }`,
    `  Supporting Evidence Pack IDs: ${
      inlineList(judgment.supportEvidenceItemIds)
    }`,
    `  Counterevidence Evidence Pack IDs: ${
      inlineList(judgment.counterEvidenceItemIds)
    }`,
    `  Unknowns: ${inlineList(judgment.unknowns)}`,
    `  Limitations: ${inlineList(judgment.limitations)}`,
    "  Component Cards:",
    indentLines(renderComponentCards(metadata), 4),
    "  Exact source lineage:",
    indentLines(renderSourceLineage(metadata), 4),
    "  Component qualifications and limitations:",
    indentLines(renderComponentLimitations(metadata), 4),
  ].join("\n");
}

function renderComponentCards(metadata: FrameworkAdvisoryMetadata): string {
  return metadata.components.length === 0
    ? "Unavailable"
    : metadata.components.map((component) =>
      [
        `- ${component.frameworkId} @ ${component.version} — ${component.name}`,
        `  Attribution: ${component.attribution.display}`,
      ].join("\n")
    ).join("\n");
}

function renderSourceLineage(metadata: FrameworkAdvisoryMetadata): string {
  const sourcesById = new Map(
    metadata.sources.map((source) => [source.sourceId, source]),
  );
  const lines = metadata.components.flatMap((component) =>
    component.sourceRefs.map((sourceRef) => {
      const source = sourcesById.get(sourceRef.sourceId);
      return [
        `- ${sourceRef.sourceId} | ${source?.url ?? "Unavailable"} |`,
        `${sourceRef.locator.kind}: ${sourceRef.locator.value}`,
        `| component ${component.frameworkId} @ ${component.version}`,
        `| title: ${source?.title ?? "Unavailable"}`,
        `| publisher: ${source?.publisher ?? "Unavailable"}`,
        `| edition: ${source?.edition ?? "Unavailable"}`,
        `| immutable revision: ${
          source
            ? renderImmutableRevision(source.immutableRevision)
            : "Unavailable"
        }`,
      ].join(" ");
    })
  );
  return lines.length === 0 ? "Unavailable" : lines.join("\n");
}

function renderImmutableRevision(
  revision: FrameworkAdvisoryMetadata["sources"][number]["immutableRevision"],
): string {
  return [
    revision.status,
    revision.hashAlgorithm ?? "no hash algorithm",
    revision.contentHash ?? "no content hash",
  ].join(" / ");
}

function renderComponentLimitations(
  metadata: FrameworkAdvisoryMetadata,
): string {
  const lines = metadata.components.flatMap((component) => {
    const limitations = [
      ...component.contraindications,
      ...component.decisionUtility.empiricalQualifications,
      ...component.review.openIssues,
      ...(component.rights.notes.length > 0 ? [component.rights.notes] : []),
    ];
    return limitations.map(
      (limitation) => `- ${component.frameworkId}: ${limitation}`,
    );
  });
  return lines.length === 0 ? "None" : lines.join("\n");
}

function componentAttributions(
  metadata: FrameworkAdvisoryMetadata,
): string {
  const attributions = [
    ...new Set(
      metadata.components.map(({ attribution }) => attribution.display),
    ),
  ];
  return attributions.length === 0 ? "Unavailable" : attributions.join("; ");
}

function namedConclusion(judgment: AdvisoryJudgment): string {
  return [
    judgment.frameworkMetadata.packName,
    `(judgment ${judgment.id}; ${judgment.conclusion})`,
  ].join(" ");
}

function isAdvisoryJudgment(
  judgment: FrameworkJudgment,
): judgment is AdvisoryJudgment {
  return judgment.frameworkMetadata !== undefined;
}

function indentLines(value: string, spaces: number): string {
  const indentation = " ".repeat(spaces);
  return value.split("\n").map((line) => `${indentation}${line}`).join("\n");
}

function inlineList(values: string[]): string {
  return values.length === 0 ? "None" : values.join("; ");
}
