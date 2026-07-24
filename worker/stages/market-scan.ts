import type {
  MarketScanOptions,
  MarketScanResult,
} from "../../lib/market/types";
import type { MarketService } from "../../lib/market/service";

export async function marketScanStage(
  options: MarketScanOptions,
  dependencies: {
    service: Pick<MarketService, "scanMarketWindow">;
  },
): Promise<MarketScanResult> {
  return dependencies.service.scanMarketWindow(options);
}
