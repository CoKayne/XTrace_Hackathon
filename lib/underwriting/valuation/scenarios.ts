import type { EvidencePack } from "../../contracts/evidence";
import type {
  ScenarioInput,
  ScenarioInputField,
  ScenarioModel,
} from "../../contracts/underwriting";
import {
  addDecimalStrings,
  normalizeDecimalString,
} from "../numbers";
import type { FormulaStatus } from "./contracts";

const scenarioNames = ["bear", "base", "bull"] as const;
const scenarioFields: ScenarioInputField[] = [
  "revenue_path",
  "arr_path",
  "growth",
  "gross_margin",
  "contribution_margin",
  "operating_expenses",
  "burn",
  "cash",
  "runway",
  "future_financing",
  "future_dilution",
  "exit_timing",
  "exit_method",
  "exit_multiple",
  "success_conditions",
  "failure_conditions",
  "probability",
];

export function buildScenarioModel(input: {
  pack: EvidencePack;
  candidateRunId: string;
  formulaPolicyVersion: string;
  probabilityWeighted: boolean;
}): ScenarioModel {
  return {
    id: `scenario-model:${input.candidateRunId}`,
    candidateRunId: input.candidateRunId,
    formulaPolicyVersion: input.formulaPolicyVersion,
    scenarios: scenarioNames.map((scenario) => ({
      name: scenario,
      inputs: scenarioFields.map((field) =>
        resolveScenarioInput(input.pack, input.candidateRunId, scenario, field)
      ),
    })),
    probabilityWeighted: input.probabilityWeighted,
  };
}

export function validateProbabilityWeights(model: ScenarioModel): {
  status: FormulaStatus;
  total: string | null;
} {
  if (!model.probabilityWeighted) {
    return { status: "not_applicable", total: null };
  }
  const values = model.scenarios.map(({ inputs }) =>
    inputs.find(({ field }) => field === "probability")?.value ?? null
  );
  if (values.some((value) => value === null)) {
    return { status: "insufficient_input", total: null };
  }
  try {
    const presentValues = values as string[];
    const total = presentValues.reduce(
      (sum, value) => addDecimalStrings(sum, value),
      normalizeDecimalString("0"),
    );
    return {
      status: total === "1" ? "completed" : "invalid_domain",
      total,
    };
  } catch {
    return { status: "invalid_domain", total: null };
  }
}

function resolveScenarioInput(
  pack: EvidencePack,
  candidateRunId: string,
  scenario: typeof scenarioNames[number],
  field: ScenarioInputField,
): ScenarioInput {
  const id = `scenario:${candidateRunId}:${scenario}:${field}`;
  const assumption = pack.assumptions.find(
    (candidate) =>
      candidate.field === field
      && candidate.scenario === scenario,
  ) ?? pack.assumptions.find(
    (candidate) =>
      candidate.field === field
      && candidate.scenario === "all",
  );
  if (assumption) {
    return {
      id,
      scenario,
      field,
      value: assumption.value,
      unit: assumption.unit,
      evidenceItemId: null,
      assumptionItemId: assumption.id,
      unavailableReason: null,
    };
  }

  const fact = pack.facts.find(
    (candidate) =>
      candidate.field === field
      && candidate.acceptedForGate,
  );
  if (fact) {
    return {
      id,
      scenario,
      field,
      value: fact.value,
      unit: fact.unit,
      evidenceItemId: fact.id,
      assumptionItemId: null,
      unavailableReason: null,
    };
  }

  return {
    id,
    scenario,
    field,
    value: null,
    unit: null,
    evidenceItemId: null,
    assumptionItemId: null,
    unavailableReason:
      `No accepted Fact or explicit Assumption is available for ${field}`,
  };
}
