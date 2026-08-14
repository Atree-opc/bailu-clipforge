import { getBailuServiceRuntime } from "@/integrations/bailu/runtime";
import { handleCreateProject, studioRouteErrorResponse } from "@/integrations/bailu/route-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    return await handleCreateProject(request, getBailuServiceRuntime());
  } catch (error) {
    return studioRouteErrorResponse(error);
  }
}
