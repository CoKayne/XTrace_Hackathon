import { jsonOk } from "../../../lib/api/response";
import { buildDemoViewModel } from "../../../lib/demo/view-model";

export async function GET() {
  return jsonOk(buildDemoViewModel().documents);
}
