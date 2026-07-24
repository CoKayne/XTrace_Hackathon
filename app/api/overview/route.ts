import { jsonOk } from "../../../lib/api/response";
import { buildDemoViewModel } from "../../../lib/demo/view-model";

export const dynamic = "force-dynamic";

export async function GET() {
  return jsonOk(buildDemoViewModel());
}
