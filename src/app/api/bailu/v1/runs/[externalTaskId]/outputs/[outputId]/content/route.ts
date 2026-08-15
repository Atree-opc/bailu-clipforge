import { getBailuServiceRuntime } from "@/integrations/bailu/runtime";
import { handleGetRunOutputContent, studioRouteErrorResponse } from "@/integrations/bailu/route-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ externalTaskId: string; outputId: string }> },
): Promise<Response> {
  try {
    const { externalTaskId, outputId } = await params;
    return await handleGetRunOutputContent(request, externalTaskId, outputId, getBailuServiceRuntime());
  } catch (error) {
    return studioRouteErrorResponse(error);
  }
}
