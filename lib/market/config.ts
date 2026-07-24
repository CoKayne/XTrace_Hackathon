import type {
  DefaultMarketProviderOptions,
  ProviderRuntime,
  RssMarketProviderConfig,
} from "./providers";

type Environment = Record<string, string | undefined>;

export interface MarketProviderConfiguration {
  options: DefaultMarketProviderOptions;
  runtime: ProviderRuntime;
  configuredProviderCount: number;
}

export function readMarketProviderConfiguration(
  environment: Environment = process.env,
): MarketProviderConfiguration {
  const officialAnnouncementFeeds = parseFeeds(
    environment.MARKET_OFFICIAL_FEEDS_JSON,
    "MARKET_OFFICIAL_FEEDS_JSON",
  );
  const stablePublisherFeeds = parseFeeds(
    environment.MARKET_PUBLISHER_FEEDS_JSON,
    "MARKET_PUBLISHER_FEEDS_JSON",
  );
  const crunchbaseApiKey = environment.CRUNCHBASE_API_KEY?.trim() || undefined;

  return {
    options: {
      officialAnnouncementFeeds,
      stablePublisherFeeds,
      crunchbaseApiKey,
    },
    runtime: {
      userAgent: environment.MARKET_USER_AGENT?.trim() || undefined,
    },
    configuredProviderCount:
      5
      + officialAnnouncementFeeds.length
      + stablePublisherFeeds.length
      + (crunchbaseApiKey ? 1 : 0),
  };
}

function parseFeeds(
  value: string | undefined,
  label: string,
): RssMarketProviderConfig[] {
  if (!value?.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) throw new Error("must be a JSON array");
    return parsed.map((item, index) => validateFeed(item, `${label}[${index}]`));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} is invalid: ${message}`);
  }
}

function validateFeed(
  value: unknown,
  label: string,
): RssMarketProviderConfig {
  if (!value || typeof value !== "object") {
    throw new Error(`${label} must be an object`);
  }
  const input = value as Record<string, unknown>;
  for (const key of ["id", "name", "url", "publisher"] as const) {
    if (typeof input[key] !== "string" || !input[key].trim()) {
      throw new Error(`${label}.${key} is required`);
    }
  }
  try {
    new URL(String(input.url));
  } catch {
    throw new Error(`${label}.url must be a URL`);
  }
  return {
    id: String(input.id),
    name: String(input.name),
    url: String(input.url),
    publisher: String(input.publisher),
    ...(typeof input.eventType === "string" ? { eventType: input.eventType } : {}),
    ...(Array.isArray(input.sectors)
      ? { sectors: input.sectors.filter((item): item is string => typeof item === "string") }
      : {}),
    ...(Array.isArray(input.themes)
      ? { themes: input.themes.filter((item): item is string => typeof item === "string") }
      : {}),
    ...(input.confidence === "low" || input.confidence === "medium" || input.confidence === "high"
      ? { confidence: input.confidence }
      : {}),
  };
}
