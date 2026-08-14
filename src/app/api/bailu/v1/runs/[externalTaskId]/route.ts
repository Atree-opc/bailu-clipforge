import { getBailuServiceRuntime } from "@/integrations/bailu/runtime";
import { handleGetRun, studioRouteErrorResponse } from "@/integrations/bailu/route-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ externalTaskId: string }> },
): Promise<Response> {
  try {
    const { externalTaskId } = await params;
    return await handleGetRun(request, externalTaskId, getBailuServiceRuntime());
  } catch (error) {
    return studioRouteErrorResponse(error);
  }
}
