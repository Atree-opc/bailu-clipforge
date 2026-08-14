import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { startProjectComposition } from "@/app/api/project/[id]/compose/route";
import { getDb } from "@/lib/db";
import { compositions } from "@/lib/db/schema";
import { composeOptionsToExistingBody, type ComposeOptions } from "./contract";
import type { ComposeAdapter, CompositionLifecycleHooks, CompositionSnapshot } from "./compose-adapter";

export class ExistingComposeAdapter implements ComposeAdapter {
  async start(
    externalProjectId: string,
    options: ComposeOptions,
    hooks: CompositionLifecycleHooks,
  ): Promise<{ accepted: boolean; status: number }> {
    const request = new NextRequest(`http://127.0.0.1/api/project/${encodeURIComponent(externalProjectId)}/compose`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(composeOptionsToExistingBody(options)),
    });
    const response = await startProjectComposition(request, externalProjectId, hooks);
    return { accepted: response.status === 202, status: response.status };
  }

  async get(compositionId: string): Promise<CompositionSnapshot | null> {
    const rows = await getDb().select().from(compositions).where(eq(compositions.id, compositionId)).limit(1);
    const row = rows[0];
    if (!row) return null;
    return { status: row.status, outputPath: row.outputPath };
  }
}
