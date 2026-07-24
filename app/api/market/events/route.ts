import { getIntelligenceRepository } from "../../../../db/repositories/intelligence";
import { jsonOk } from "../../../../lib/api/response";

const WORKSPACE_ID = "workspace_demo";

export const dynamic = "force-dynamic";

export async function GET() {
  return jsonOk(await getIntelligenceRepository().listMarketEvents(WORKSPACE_ID));
}
