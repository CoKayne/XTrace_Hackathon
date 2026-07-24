export interface DemoDealEvidence {
  id: string;
  documentId: string;
  dealId: string;
  companyName: string;
  provenance: "source_document";
  page: number;
  fact: string;
  excerpt: string;
}

// These excerpts were read from the indicated pages of the bundled source PDFs.
// They are source evidence, not synthetic fixture content.
export const DEMO_DEAL_EVIDENCE: readonly DemoDealEvidence[] = [
  {
    id: "evidence_100plus_page_1",
    documentId: "doc_100plus",
    dealId: "deal_100plus",
    companyName: "100Plus",
    provenance: "source_document",
    page: 1,
    fact: "The 100Plus deck presents the company as an AI-assisted remote patient monitoring platform.",
    excerpt: "The Leading AI-Assisted Remote Patient Monitoring Platform",
  },
  {
    id: "evidence_1906_page_5",
    documentId: "doc_1906",
    dealId: "deal_1906",
    companyName: "1906",
    provenance: "source_document",
    page: 5,
    fact: "The 1906 deck says the company develops non-smokable, controlled-dose cannabis and plant-medicine products.",
    excerpt: "Our company is pioneering ways to deliver NON-SMOKABLE controlled doses of cannabis and plant medicines in safe, discreet and user-friendly formats.",
  },
  {
    id: "evidence_7bridges_page_4",
    documentId: "doc_7bridges",
    dealId: "deal_7bridges",
    companyName: "7bridges",
    provenance: "source_document",
    page: 4,
    fact: "The 7bridges deck describes the company as an AI-powered logistics platform.",
    excerpt: "7bridges is a unified, AI powered logistics platform.",
  },
  {
    id: "evidence_ably_page_5",
    documentId: "doc_ably",
    dealId: "deal_ably",
    companyName: "Ably",
    provenance: "source_document",
    page: 5,
    fact: "The Ably deck describes a cloud-native pub/sub platform for dependable realtime communication at the edge.",
    excerpt: "Ably is architected around four pillars of dependability, for realtime communication at the edge, delivered as a cloud-native pub/sub platform.",
  },
  {
    id: "evidence_a_champs_page_3",
    documentId: "doc_a_champs",
    dealId: "deal_a_champs",
    companyName: "A-Champs",
    provenance: "source_document",
    page: 3,
    fact: "The A-Champs deck presents ROXs Pro as a smart assistant for sports and health professionals.",
    excerpt: "Smart Assistant for Sports & Health professionals. ROXs PRO.",
  },
  {
    id: "evidence_acquco_page_3",
    documentId: "doc_acquco",
    dealId: "deal_acquco",
    companyName: "Acquco",
    provenance: "source_document",
    page: 3,
    fact: "The Acquco deck says the company acquires Amazon brands and applies established playbooks to scale revenue.",
    excerpt: "Acquire Amazon brands at attractive multiples and utilize well established playbooks to quickly scale revenue.",
  },
  {
    id: "evidence_ada_health_page_4",
    documentId: "doc_ada_health",
    dealId: "deal_ada_health",
    companyName: "Ada Health",
    provenance: "source_document",
    page: 4,
    fact: "The Ada Health deck presents Ada as a health companion with a conversational interface and diagnostic reasoning.",
    excerpt: "Ada — your best-in-class health companion. Conversational interface. Diagnostic reasoning.",
  },
  {
    id: "evidence_acin_page_2",
    documentId: "doc_acin",
    dealId: "deal_acin",
    companyName: "Acin",
    provenance: "source_document",
    page: 2,
    fact: "The Acin deck says its purpose is to connect financial institutions digitally for proactive operational-risk management.",
    excerpt: "Connecting financial institutions together digitally is critical to the proactive management of Operational Risk.",
  },
  {
    id: "evidence_intertwin_ai_page_1",
    documentId: "doc_pitch_combined",
    dealId: "deal_intertwin_ai",
    companyName: "InterTwin.ai",
    provenance: "source_document",
    page: 1,
    fact: "InterTwin.ai presents continuously evolving multimodal AI consumer twins for modelling customer behaviour.",
    excerpt: "Continuously Evolving Multimodal AI Consumer Twins",
  },
  {
    id: "evidence_unikudo_page_2",
    documentId: "doc_pitch_combined",
    dealId: "deal_unikudo",
    companyName: "UniKudo",
    provenance: "source_document",
    page: 2,
    fact: "UniKudo presents one guided dashboard for navigating Taiwanese university applications.",
    excerpt: "We turn 70+ scattered, often confusing university portals into one guided path to a Taiwanese degree.",
  },
  {
    id: "evidence_mirror_page_3",
    documentId: "doc_pitch_combined",
    dealId: "deal_mirror",
    companyName: "Mirror",
    provenance: "source_document",
    page: 3,
    fact: "Mirror presents an AI speech coach that rewrites speech and plays it back in the user's cloned voice while preserving their accent.",
    excerpt: "You speak → AI rewrites → You hear it back in your own cloned voice — accent kept, not erased.",
  },
  {
    id: "evidence_coupro_page_4",
    documentId: "doc_pitch_combined",
    dealId: "deal_coupro",
    companyName: "CouPro",
    provenance: "source_document",
    page: 4,
    fact: "The CouPro one-pager describes a local coupon network that reached more than 500 users.",
    excerpt: "Traction: Deployed a local coupon network driving 500+ users and achieving 10% merchant revenue gains.",
  },
  {
    id: "evidence_indieshow_page_5",
    documentId: "doc_pitch_combined",
    dealId: "deal_indieshow",
    companyName: "IndieShow",
    provenance: "source_document",
    page: 5,
    fact: "IndieShow presents AI-assisted promotion, event pages, ticketing, waitlists and on-site check-in for performing-arts teams.",
    excerpt: "Now a platform to generate promo content with AI, build event pages, and manage tickets, waitlists & on-site check-in.",
  },
  {
    id: "evidence_humetric_page_6",
    documentId: "doc_pitch_combined",
    dealId: "deal_humetric",
    companyName: "HuMetric",
    provenance: "source_document",
    page: 6,
    fact: "HuMetric presents an open, consent-based and agent-queryable infrastructure layer for verified people data.",
    excerpt: "HuMetric is the open, authorized infrastructure layer for people data — like GitHub or Google Maps, but for humans.",
  },
  {
    id: "evidence_alpha_builders_page_7",
    documentId: "doc_pitch_combined",
    dealId: "deal_alpha_builders",
    companyName: "Alpha Builders",
    provenance: "source_document",
    page: 7,
    fact: "Alpha Builders presents plain-English, research-backed stock strategy construction and historical testing.",
    excerpt: "Alpha Builders lets anyone do professional-grade stock research — in plain English.",
  },
  {
    id: "evidence_innformnest_page_8",
    documentId: "doc_pitch_combined",
    dealId: "deal_innformnest",
    companyName: "INNFormNest",
    provenance: "source_document",
    page: 8,
    fact: "INNFormNest presents a spray intended to treat onychomycosis and reduce recurrence.",
    excerpt: "Spray for Complete Cure of Onychomycosis. Designed for No Recurrence.",
  },
  {
    id: "evidence_silvermemory_page_9",
    documentId: "doc_pitch_combined",
    dealId: "deal_silvermemory",
    companyName: "SilverMemory",
    provenance: "source_document",
    page: 9,
    fact: "SilverMemory presents an AgeTech voice-AI cognitive-care concept connecting elderly storytelling, professional care and family.",
    excerpt: "AgeTech. VoiceAI. CognitiveCare.",
  },
  {
    id: "evidence_kanesh_page_10",
    documentId: "doc_pitch_combined",
    dealId: "deal_kanesh",
    companyName: "Kanesh",
    provenance: "source_document",
    page: 10,
    fact: "Kanesh presents privacy-preserving Digital Product Passport compliance infrastructure for manufacturing supply chains.",
    excerpt: "Privacy-preserving Digital Product Passports. Compliance infrastructure for manufacturing supply chains.",
  },
  {
    id: "evidence_fellowtrip_page_11",
    documentId: "doc_pitch_combined",
    dealId: "deal_fellowtrip",
    companyName: "Fellowtrip",
    provenance: "source_document",
    page: 11,
    fact: "Fellowtrip presents a collaboration layer for people to plan and travel together.",
    excerpt: "The collaboration layer for travel — plan and travel together, from finding your people to going.",
  },
];

export function getDemoEvidenceForDocument(documentId: string): DemoDealEvidence | undefined {
  return DEMO_DEAL_EVIDENCE.find((evidence) => evidence.documentId === documentId);
}

export function getDemoEvidenceForDeal(dealId: string): DemoDealEvidence | undefined {
  return DEMO_DEAL_EVIDENCE.find((evidence) => evidence.dealId === dealId);
}
