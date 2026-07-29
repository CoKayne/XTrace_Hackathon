export type FrameworkPublicationStatus = "published";

export interface SyntheticFrameworkCardFixture {
  id: string;
  version: string;
  title: string;
  synthetic: true;
  publicationStatus: FrameworkPublicationStatus;
  attribution: "Product-owned synthetic fixture";
  approvedNeutralParaphrase: string;
  locator: string;
  limitations: string[];
  rightsStatus: "product_owned_synthetic";
  formalDecisionWeight: "0";
}

export interface SyntheticFrameworkPackFixture {
  id: string;
  version: string;
  title: string;
  synthetic: true;
  publicationStatus: FrameworkPublicationStatus;
  cards: SyntheticFrameworkCardFixture[];
}

export const SYNTHETIC_FRAMEWORK_PACK_ID =
  "framework_pack_synthetic_universal_saas_ai_v1";

const CARD_TITLES = [
  "Market Size & Why Now",
  "Founder & Unique Insight",
  "Product-Market Fit & Customer Evidence",
  "Contrarian Market Structure",
  "Durable Competitive Power",
  "GTM & Unit Economics",
  "Revenue Quality & Retention",
  "Valuation & Fund Return",
] as const;

export const SYNTHETIC_FRAMEWORK_PACK: SyntheticFrameworkPackFixture = {
  id: SYNTHETIC_FRAMEWORK_PACK_ID,
  version: "1",
  title: "Synthetic universal SaaS and Enterprise AI evaluation fixtures",
  synthetic: true,
  publicationStatus: "published",
  cards: CARD_TITLES.map((title, index) => ({
    id: `framework_card_synthetic_${index + 1}_v1`,
    version: "1",
    title,
    synthetic: true,
    publicationStatus: "published",
    attribution: "Product-owned synthetic fixture",
    approvedNeutralParaphrase:
      `Synthetic test lens ${index + 1}: evaluate ${title.toLowerCase()} using only source-grounded company evidence.`,
    locator: `synthetic://framework/${index + 1}`,
    limitations: [
      "Synthetic fixture for executable infrastructure tests only.",
      "Carries no formal decision weight.",
    ],
    rightsStatus: "product_owned_synthetic",
    formalDecisionWeight: "0",
  })),
};
