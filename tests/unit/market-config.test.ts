import assert from "node:assert/strict";
import test from "node:test";

import { readMarketProviderConfiguration } from "../../lib/market/config";

test("market provider configuration defaults to the eight-source demo mix", () => {
  const configuration = readMarketProviderConfiguration({});

  assert.equal(configuration.configuredProviderCount, 8);
  assert.deepEqual(
    configuration.options.officialAnnouncementFeeds?.map((feed) => feed.id),
    ["sequoia-official", "lightspeed-official"],
  );
  assert.deepEqual(
    configuration.options.stablePublisherFeeds?.map((feed) => feed.id),
    ["a16z-news"],
  );
});

test("explicit empty market feed arrays disable the default VC feeds", () => {
  const configuration = readMarketProviderConfiguration({
    MARKET_OFFICIAL_FEEDS_JSON: "[]",
    MARKET_PUBLISHER_FEEDS_JSON: "[]",
  });

  assert.equal(configuration.configuredProviderCount, 5);
  assert.deepEqual(configuration.options.officialAnnouncementFeeds, []);
  assert.deepEqual(configuration.options.stablePublisherFeeds, []);
});

test("market provider configuration reads declared feeds and identified user agent", () => {
  const configuration = readMarketProviderConfiguration({
    CRUNCHBASE_API_KEY: "cb-key",
    MARKET_USER_AGENT: "VSee VC Demo market@example.com",
    MARKET_OFFICIAL_FEEDS_JSON: JSON.stringify([{
      id: "vc-announcements",
      name: "VC announcements",
      url: "https://example.com/feed.xml",
      publisher: "Example VC",
      confidence: "medium",
    }]),
  });

  assert.equal(configuration.options.crunchbaseApiKey, "cb-key");
  assert.equal(configuration.options.officialAnnouncementFeeds?.length, 1);
  assert.equal(configuration.options.stablePublisherFeeds?.length, 1);
  assert.equal(configuration.runtime.userAgent, "VSee VC Demo market@example.com");
  assert.equal(configuration.configuredProviderCount, 8);
});

test("market provider configuration rejects malformed feed JSON", () => {
  assert.throws(
    () => readMarketProviderConfiguration({
      MARKET_OFFICIAL_FEEDS_JSON: '[{"id":"bad"}]',
    }),
    /MARKET_OFFICIAL_FEEDS_JSON/i,
  );
});
