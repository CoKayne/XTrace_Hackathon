// Display-only sample enrichment for the Deals view. These figures are
// fabricated demo data about a real company, so they carry a permanent
// "Sample deal profile" label, exactly like the sample decision records.
//
// This module must never feed memory bundles, XTrace ingest, recall queries,
// or matching input: the analysis pipeline only reasons over evidence that
// can be cited, and judgment fingerprints must not change when presentation
// data changes. A regression test pins both properties.

export const SAMPLE_DEAL_PROFILE_LABEL = "Sample deal profile" as const;

export type SampleDealProfile = {
  label: typeof SAMPLE_DEAL_PROFILE_LABEL;
  traction: Array<{ metric: string; value: string }>;
  dealTerms: Array<{ term: string; value: string }>;
};

export const SAMPLE_DEAL_PROFILES: Record<string, SampleDealProfile> = {
  deal_1906: {
    label: SAMPLE_DEAL_PROFILE_LABEL,
    traction: [
      { metric: "TTM net revenue", value: "$9.8M (+72% YoY)" },
      { metric: "Retail distribution", value: "940 doors across 8 states" },
      { metric: "D2C revenue share", value: "22% of net revenue" },
      { metric: "Blended gross margin", value: "54%" },
      { metric: "90-day repeat purchase rate", value: "41%" },
      { metric: "Average retail velocity", value: "$410 / door / month" },
    ],
    dealTerms: [
      { term: "Round", value: "Series B" },
      { term: "Raise", value: "$12M" },
      { term: "Valuation", value: "$48M pre-money · $60M post-money" },
    ],
  },
};
