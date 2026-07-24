import { createRunsRepository } from "../../../../db/repositories/runs";
import { getDataClient } from "../../../../db/client";
import { jsonError, jsonOk } from "../../../../lib/api/response";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const run = await createRunsRepository(getDataClient()).get(id);
  return run
    ? jsonOk(run)
    : jsonError("NOT_FOUND", `Run ${id} was not found`, 404);
}
