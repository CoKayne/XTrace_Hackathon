import type {
  MarketConfidence,
  NormalizedMarketEvent,
} from "./types";

const TRACKING_PARAMETERS = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
]);

const CONFIDENCE_RANK: Record<MarketConfidence, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

export function canonicalizeUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError(`Unsupported market source URL protocol: ${url.protocol}`);
  }

  url.hash = "";
  url.username = "";
  url.password = "";

  const retainedParameters = [...url.searchParams.entries()]
    .filter(([name]) => {
      const normalized = name.toLowerCase();
      return !normalized.startsWith("utm_")
        && !TRACKING_PARAMETERS.has(normalized);
    })
    .sort(([leftName, leftValue], [rightName, rightValue]) => (
      leftName.localeCompare(rightName) || leftValue.localeCompare(rightValue)
    ));

  url.search = "";
  for (const [name, value] of retainedParameters) {
    url.searchParams.append(name, value);
  }

  if (url.pathname !== "/") {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }

  return url.toString().replace(/\/$/, "");
}

export function withinPublicationWindow(
  publishedAt: string,
  now: Date,
  days: number,
): boolean {
  const publicationTime = Date.parse(publishedAt);
  const upperBound = now.getTime();
  if (
    !Number.isFinite(publicationTime)
    || !Number.isFinite(upperBound)
    || !Number.isFinite(days)
    || days <= 0
  ) {
    return false;
  }

  const lowerBound = upperBound - days * 24 * 60 * 60 * 1_000;
  return publicationTime >= lowerBound && publicationTime <= upperBound;
}

export const withinWindow = withinPublicationWindow;

function normalizedTitleTokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean),
  );
}

function titleSimilarity(left: string, right: string): number {
  const leftTokens = normalizedTitleTokens(left);
  const rightTokens = normalizedTitleTokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      intersection += 1;
    }
  }

  return intersection / new Set([...leftTokens, ...rightTokens]).size;
}

function publicationDay(event: NormalizedMarketEvent): string {
  return event.publishedAt.slice(0, 10);
}

function sharesEntity(
  left: NormalizedMarketEvent,
  right: NormalizedMarketEvent,
): boolean {
  const rightEntities = new Set(right.entityKeys ?? []);
  return (left.entityKeys ?? []).some((entity) => rightEntities.has(entity));
}

function eventsMatch(
  left: NormalizedMarketEvent,
  right: NormalizedMarketEvent,
): boolean {
  if (canonicalizeUrl(left.canonicalUrl) === canonicalizeUrl(right.canonicalUrl)) {
    return true;
  }
  if (
    left.contentChecksum.length > 0
    && left.contentChecksum === right.contentChecksum
  ) {
    return true;
  }

  if (publicationDay(left) !== publicationDay(right)) {
    return false;
  }

  const similarity = titleSimilarity(left.title, right.title);
  return similarity >= 0.85
    || (
      left.eventType === right.eventType
      && sharesEntity(left, right)
      && similarity >= 0.75
    );
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function preferredEvent(
  left: NormalizedMarketEvent,
  right: NormalizedMarketEvent,
): NormalizedMarketEvent {
  if (CONFIDENCE_RANK[right.confidence] !== CONFIDENCE_RANK[left.confidence]) {
    return CONFIDENCE_RANK[right.confidence] > CONFIDENCE_RANK[left.confidence]
      ? right
      : left;
  }
  if (right.sources.length !== left.sources.length) {
    return right.sources.length > left.sources.length ? right : left;
  }
  return Date.parse(right.retrievedAt) > Date.parse(left.retrievedAt)
    ? right
    : left;
}

function mergeEvents(
  left: NormalizedMarketEvent,
  right: NormalizedMarketEvent,
): NormalizedMarketEvent {
  const preferred = preferredEvent(left, right);
  const sources = [...left.sources, ...right.sources].filter(
    (source, index, all) => all.findIndex((candidate) => (
      candidate.id === source.id
    )) === index,
  );

  return {
    ...preferred,
    canonicalUrl: canonicalizeUrl(preferred.canonicalUrl),
    sectors: unique([...left.sectors, ...right.sectors]),
    themes: unique([...left.themes, ...right.themes]),
    positiveImplications: unique([
      ...left.positiveImplications,
      ...right.positiveImplications,
    ]),
    negativeImplications: unique([
      ...left.negativeImplications,
      ...right.negativeImplications,
    ]),
    entityKeys: unique([
      ...(left.entityKeys ?? []),
      ...(right.entityKeys ?? []),
    ]),
    sources,
  };
}

export function dedupeEvents(
  events: NormalizedMarketEvent[],
): NormalizedMarketEvent[] {
  const deduplicated: NormalizedMarketEvent[] = [];

  for (const event of events) {
    const canonicalEvent = {
      ...event,
      canonicalUrl: canonicalizeUrl(event.canonicalUrl),
    };
    const matchIndex = deduplicated.findIndex((candidate) => (
      eventsMatch(candidate, canonicalEvent)
    ));

    if (matchIndex === -1) {
      deduplicated.push(canonicalEvent);
      continue;
    }

    deduplicated[matchIndex] = mergeEvents(
      deduplicated[matchIndex],
      canonicalEvent,
    );
  }

  return deduplicated;
}
