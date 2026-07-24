import { jsonError, jsonOk } from "../../../../lib/api/response";
import { buildDemoViewModel } from "../../../../lib/demo/view-model";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const deal = buildDemoViewModel().deals.find((candidate) => candidate.id === id);
  return deal
    ? jsonOk(deal)
    : jsonError("NOT_FOUND", `Deal ${id} was not found`, 404);
}
