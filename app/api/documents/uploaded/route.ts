import { getUploadedDocumentsRepository } from "../../../../db/repositories/uploaded-documents";
import { errorResponse, jsonOk } from "../../../../lib/api/response";

const WORKSPACE_ID = "workspace_demo";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return jsonOk(await getUploadedDocumentsRepository().list(WORKSPACE_ID));
  } catch (error) {
    return errorResponse(error);
  }
}
