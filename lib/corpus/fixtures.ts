import { DEMO_FIXTURE_LABEL, type DealStatus } from "../contracts/domain";

export interface DemoFixture {
  id: string;
  documentId: string;
  dealId: string;
  companyName: string;
  occurredAt: string;
  provenance: "demo_fixture";
  label: typeof DEMO_FIXTURE_LABEL;
  status: DealStatus;
  concerns: string[];
  revisitConditions: string[];
  meetingSummary: string;
}

// These are intentionally internal decision records. They do not assert company,
// customer, funding, product, or regulatory facts beyond the supplied documents.
export const DEMO_FIXTURES: readonly DemoFixture[] = [
  {
    id: "fixture_7bridges_passed",
    documentId: "doc_7bridges",
    dealId: "deal_7bridges",
    companyName: "7bridges",
    occurredAt: "2026-07-01T16:00:00.000Z",
    provenance: "demo_fixture",
    label: DEMO_FIXTURE_LABEL,
    status: "passed",
    concerns: ["The investment team wanted a clearer path to repeatable adoption."],
    revisitConditions: ["Revisit when the team can review new source-backed operating evidence."],
    meetingSummary: "Synthetic internal note: the team passed after an initial review and recorded the evidence needed for a future revisit.",
  },
  {
    id: "fixture_a_champs_watchlist",
    documentId: "doc_a_champs",
    dealId: "deal_a_champs",
    companyName: "A-Champs",
    occurredAt: "2026-07-02T16:00:00.000Z",
    provenance: "demo_fixture",
    label: DEMO_FIXTURE_LABEL,
    status: "watchlist",
    concerns: ["The team wanted to see how the opportunity develops against relevant market themes."],
    revisitConditions: ["Revisit when new source-backed information provides a concrete reason to compare the opportunity again."],
    meetingSummary: "Synthetic internal note: the team kept this Deal on a watchlist for a later evidence-backed review.",
  },
  {
    id: "fixture_ada_health_evaluating",
    documentId: "doc_ada_health",
    dealId: "deal_ada_health",
    companyName: "Ada Health",
    occurredAt: "2026-07-03T16:00:00.000Z",
    provenance: "demo_fixture",
    label: DEMO_FIXTURE_LABEL,
    status: "evaluating",
    concerns: ["The team needs to distinguish source-supported facts from its internal assessment."],
    revisitConditions: ["Revisit after the next diligence discussion is supported by cited source material."],
    meetingSummary: "Synthetic internal note: the team is evaluating the Deal and has documented its diligence questions.",
  },
  {
    id: "fixture_acin_invested",
    documentId: "doc_acin",
    dealId: "deal_acin",
    companyName: "Acin",
    occurredAt: "2026-07-04T16:00:00.000Z",
    provenance: "demo_fixture",
    label: DEMO_FIXTURE_LABEL,
    status: "invested",
    concerns: ["The team wants periodic evidence-backed monitoring rather than unsupported updates."],
    revisitConditions: ["Revisit when relevant public or source-document evidence warrants a portfolio-context review."],
    meetingSummary: "Synthetic internal note: the team recorded this Deal as invested for the demo's historical-context workflow.",
  },
];

export function getDemoFixtureForDocument(documentId: string): DemoFixture | undefined {
  return DEMO_FIXTURES.find((fixture) => fixture.documentId === documentId);
}

export function getDemoFixtureForDeal(dealId: string): DemoFixture | undefined {
  return DEMO_FIXTURES.find((fixture) => fixture.dealId === dealId);
}
