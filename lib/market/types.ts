import type { MarketEvent } from "../contracts/domain";

export type MarketConfidence = MarketEvent["confidence"];

export interface MarketFetchWindow {
  from: Date;
  to: Date;
}

export interface RawSourceItem {
  providerId: string;
  externalId?: string;
  title: string;
  url: string;
  publisher: string;
  publishedAt?: string;
  retrievedAt?: string;
  updatedAt?: string;
  summary?: string;
  evidenceExcerpt?: string;
  eventType?: string;
  entities?: string[];
  sectors?: string[];
  themes?: string[];
  positiveImplications?: string[];
  negativeImplications?: string[];
  confidence?: MarketConfidence;
}

export interface MarketProvider {
  id: string;
  name: string;
  fetch(window: MarketFetchWindow): Promise<RawSourceItem[]>;
}

export interface NormalizedMarketEvent extends MarketEvent {
  canonicalUrl: string;
  contentChecksum: string;
  retrievedAt: string;
  updatedAt?: string;
  providerId: string;
  entityKeys?: string[];
}

export interface MarketProviderReport {
  providerId: string;
  providerName: string;
  fetchedCount: number;
  acceptedCount: number;
  rejectedCount: number;
  error?: string;
  lastSuccessAt?: string;
}

export interface MarketScanResult {
  status: "completed" | "partial" | "failed";
  window: {
    from: string;
    to: string;
    days: number;
  };
  events: NormalizedMarketEvent[];
  providers: MarketProviderReport[];
}

export interface MarketScanOptions {
  days?: number;
  now?: Date;
}

export type PersistMarketEvents = (
  events: NormalizedMarketEvent[],
) => Promise<void> | void;
