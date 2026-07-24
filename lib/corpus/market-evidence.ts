import type { SourceRef } from "../contracts/domain";

export interface DemoMarketReportEvidence {
  documentId: string;
  fact: string;
  source: SourceRef;
}

// Short excerpts were read from the indicated pages of the four supplied
// market reports. These are baseline research sources, not recent market events.
export const DEMO_MARKET_REPORT_EVIDENCE: readonly DemoMarketReportEvidence[] = [
  {
    documentId: "report_venture_outlook_2026",
    fact: "The supplied 2026 US VC outlook describes H1 activity as both contradictory and concentrated, with record-setting top-line activity driven by unusually large AI rounds.",
    source: {
      id: "evidence_us_vc_outlook_page_2",
      provenance: "source_document",
      title: "2026 US Venture Capital Outlook — Midyear Update",
      documentId: "report_venture_outlook_2026",
      page: 2,
      excerpt: "The first half of 2026 has been six months of contradiction and concentration. Based on top-line figures, H1 2026 VC activity has been record-breaking.",
    },
  },
  {
    documentId: "report_ai_vc_trends_q1_2026",
    fact: "The supplied AI VC trends report says Q1 2026 funding was highly concentrated in horizontal platforms and a handful of megadeals.",
    source: {
      id: "evidence_ai_vc_trends_page_4",
      provenance: "source_document",
      title: "Q1 2026 AI VC Trends",
      documentId: "report_ai_vc_trends_q1_2026",
      page: 4,
      excerpt: "Total funding reached $255.5 billion, driven by an extraordinary concentration of capital in horizontal platforms.",
    },
  },
  {
    documentId: "report_robotics_physical_ai_q1_2026",
    fact: "The supplied robotics report says Q1 2026 diligence increasingly emphasized production scale, paying customers, recurring contracts, and repeat orders.",
    source: {
      id: "evidence_robotics_vc_trends_page_4",
      provenance: "source_document",
      title: "Q1 2026 Robotics & Physical AI VC Trends",
      documentId: "report_robotics_physical_ai_q1_2026",
      page: 4,
      excerpt: "Can the company build at volume, and does it hold a paying customer? RaaS contracts and repeat commercial orders are the signal.",
    },
  },
  {
    documentId: "report_silicon_photonics_2024",
    fact: "The supplied silicon photonics report identifies AI and machine-learning data-center requirements as a driver of faster interconnect demand.",
    source: {
      id: "evidence_silicon_photonics_page_14",
      provenance: "source_document",
      title: "Silicon Photonics 2024 — SOI, SiN and LNOI",
      documentId: "report_silicon_photonics_2024",
      page: 14,
      excerpt: "Substantial data center requirements, particularly in the domains of artificial intelligence and machine learning, are expected to fuel the ongoing demand for swifter applications and computations.",
    },
  },
];
