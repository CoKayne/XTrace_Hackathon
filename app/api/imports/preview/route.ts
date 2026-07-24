import { z } from "zod";

import { errorResponse, jsonOk } from "../../../../lib/api/response";
import { previewImport } from "../../../../lib/corpus/service";

const PreviewRequestSchema = z.object({
  documentIds: z.array(z.string().min(1)).min(1),
});

export async function POST(request: Request) {
  try {
    const { documentIds } = PreviewRequestSchema.parse(await request.json());
    return jsonOk(previewImport(documentIds));
  } catch (error) {
    return errorResponse(error);
  }
}
