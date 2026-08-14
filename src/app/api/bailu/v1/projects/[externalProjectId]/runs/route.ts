import { getBailuServiceRuntime } from "@/integrations/bailu/runtime";
import { handleStartRun, studioRouteErrorResponse } from "@/integrations/bailu/route-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ externalProjectId: string }> },
): Promise<Response> {
  try {
    const { externalProjectId } = await params;
    return await handleStartRun(request, externalProjectId, getBailuServiceRuntime());
  } catch (error) {
    return studioRouteErrorResponse(error);
  }
}
