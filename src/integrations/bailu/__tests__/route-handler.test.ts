import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createHash } from "crypto";
import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { BAILU_AUTH_HEADERS, signBailuRequest, type BailuServiceCredentials } from "../auth";
import { BailuCallbackDelivery } from "../callback";
import type { ComposeAdapter, CompositionLifecycleHooks } from "../compose-adapter";
import { BailuServiceLedger } from "../ledger";
import { handleCreateProject, handleGetRun, handleStartRun, studioRouteErrorResponse } from "../route-handler";
import { BailuRuntimeConfigError, type BailuServiceRuntime } from "../runtime";
import { BailuStudioService } from "../service";
import { generateRealMp4 } from "./real-mp4";

const credentials: BailuServiceCredentials = { keyId: "main-local", secret: "route-handler-test-secret" };
const roots: string[] = [];

class RouteComposeAdapter implements ComposeAdapter {
  starts = 0;
  hooks: CompositionLifecycleHooks | null = null;

  async start(_projectId: string, _options: Record<string, unknown>, hooks: CompositionLifecycleHooks) {
    this.starts += 1;
    this.hooks = hooks;
    await hooks.onCreated("composition-route-1");
    return { accepted: true, status: 202 };
  }

  async get() {
    return { status: "composing" as const, outputPath: null };
  }
}

function setup(): { sqlite: Database.Database; outputRoot: string; runtime: BailuServiceRuntime; compose: RouteComposeAdapter } {
  const sqlite = new Database(":memory:");
  migrate(drizzle(sqlite), { migrationsFolder: resolve(process.cwd(), "drizzle") });
  const outputRoot = mkdtempSync(join(tmpdir(), "bailu-route-output-"));
  roots.push(outputRoot);
  const ledger = new BailuServiceLedger(sqlite);
  const compose = new RouteComposeAdapter();
  const service = new BailuStudioService({
    ledger,
    compose,
    callback: new BailuCallbackDelivery(ledger, { credentials }),
    outputRoot,
  });
  return { sqlite, outputRoot, runtime: { credentials, service }, compose };
}

function signedRequest(input: {
  pathname: string;
  method: "GET" | "POST";
  body?: unknown;
  idempotencyKey: string;
  nonce: string;
  claimedBodySha256?: string;
}): Request {
  const rawBody = input.method === "GET" ? "" : JSON.stringify(input.body);
  const bodySha256 = input.claimedBodySha256 ?? createHash("sha256").update(rawBody).digest("hex");
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signBailuRequest(
    {
      method: input.method,
      pathname: input.pathname,
      timestamp,
      nonce: input.nonce,
      idempotencyKey: input.idempotencyKey,
      bodySha256,
    },
    credentials,
  );
  return new Request(`http://127.0.0.1${input.pathname}`, {
    method: input.method,
    headers: {
      ...(input.method === "POST" && { "content-type": "application/json" }),
      [BAILU_AUTH_HEADERS.keyId]: credentials.keyId,
      [BAILU_AUTH_HEADERS.timestamp]: String(timestamp),
      [BAILU_AUTH_HEADERS.nonce]: input.nonce,
      [BAILU_AUTH_HEADERS.idempotencyKey]: input.idempotencyKey,
      [BAILU_AUTH_HEADERS.bodySha256]: bodySha256,
      [BAILU_AUTH_HEADERS.signature]: signature,
    },
    ...(input.method === "POST" && { body: rawBody }),
  });
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Bailu Next route boundary", () => {
  it("runs signed create/run/status and keeps replay idempotent", async () => {
    const { sqlite, outputRoot, runtime, compose } = setup();
    const createBody = {
      contract_version: "bailu.studio/1.0",
      studio_project_binding_id: "binding-route-1",
      title: "路由商品短片",
    };
    const first = await handleCreateProject(
      signedRequest({
        pathname: "/api/bailu/v1/projects",
        method: "POST",
        body: createBody,
        idempotencyKey: "create-route-1",
        nonce: "AAECAwQFBgcICQoLDA0ODw",
      }),
      runtime,
    );
    expect(first.status).toBe(201);
    expect(first.headers.get("cache-control")).toBe("no-store");
    const created = (await first.json()) as { external_project_id: string };
    const replay = await handleCreateProject(
      signedRequest({
        pathname: "/api/bailu/v1/projects",
        method: "POST",
        body: createBody,
        idempotencyKey: "create-route-1",
        nonce: "EBESExQVFhcYGRobHB0eHw",
      }),
      runtime,
    );
    expect((await replay.json()) as object).toMatchObject({ external_project_id: created.external_project_id });

    const runPath = `/api/bailu/v1/projects/${created.external_project_id}/runs`;
    const run = await handleStartRun(
      signedRequest({
        pathname: runPath,
        method: "POST",
        body: {
          contract_version: "bailu.studio/1.0",
          studio_run_id: "studio-run-route-1",
          operation: "compose",
          input_sha256: "a".repeat(64),
          options: {},
        },
        idempotencyKey: "run-route-1",
        nonce: "ICEiIyQlJicoKSorLC0uLw",
      }),
      created.external_project_id,
      runtime,
    );
    expect(run.status).toBe(202);
    const accepted = (await run.json()) as { external_task_id: string };
    const statusPath = `/api/bailu/v1/runs/${accepted.external_task_id}`;
    const status = await handleGetRun(
      signedRequest({
        pathname: statusPath,
        method: "GET",
        idempotencyKey: "status-route-1",
        nonce: "MDEyMzQ1Njc4OTo7PD0-Pw",
      }),
      accepted.external_task_id,
      runtime,
    );
    expect(await status.json()).toMatchObject({ state: "running", outputs: [] });
    const projectOutput = join(outputRoot, created.external_project_id);
    mkdirSync(projectOutput);
    const realMp4 = join(projectOutput, "final.mp4");
    generateRealMp4(realMp4);
    await compose.hooks?.onTerminal("composition-route-1", "done", realMp4);
    const terminal = await handleGetRun(
      signedRequest({
        pathname: statusPath,
        method: "GET",
        idempotencyKey: "status-route-2",
        nonce: "QUJDREVGR0hJSktMTU5PUA",
      }),
      accepted.external_task_id,
      runtime,
    );
    expect(await terminal.json()).toMatchObject({
      state: "succeeded",
      outputs: [{ relative_path: expect.stringMatching(/^[^\\:]+\/final\.mp4$/u), mime_type: "video/mp4" }],
      error_code: null,
    });
    expect(compose.starts).toBe(1);
    sqlite.close();
  });

  it("rejects a reused verified nonce and a strict-parser violation", async () => {
    const { sqlite, runtime } = setup();
    const nonce = "QEFCQ0RFRkdISUpLTE1OTw";
    const body = {
      contract_version: "bailu.studio/1.0",
      studio_project_binding_id: "binding-route-1",
      title: "商品短片",
    };
    const first = signedRequest({
      pathname: "/api/bailu/v1/projects",
      method: "POST",
      body,
      idempotencyKey: "create-route-1",
      nonce,
    });
    expect((await handleCreateProject(first, runtime)).status).toBe(201);
    const replayedNonce = signedRequest({
      pathname: "/api/bailu/v1/projects",
      method: "POST",
      body,
      idempotencyKey: "create-route-1",
      nonce,
    });
    const replayResponse = await handleCreateProject(replayedNonce, runtime);
    expect(replayResponse.status).toBe(409);
    expect(await replayResponse.json()).toMatchObject({ error_code: "studio_auth_replayed" });

    const invalid = signedRequest({
      pathname: "/api/bailu/v1/projects",
      method: "POST",
      body: { ...body, workspace_id: "must-not-cross" },
      idempotencyKey: "create-route-2",
      nonce: "UFFSU1RVVldYWVpbXF1eXw",
    });
    const invalidResponse = await handleCreateProject(invalid, runtime);
    expect(invalidResponse.status).toBe(400);
    expect(await invalidResponse.json()).toMatchObject({ error_code: "studio_request_invalid" });
    sqlite.close();
  });

  it("does not persist a nonce when raw body verification fails", async () => {
    const { sqlite, runtime } = setup();
    const response = await handleCreateProject(
      signedRequest({
        pathname: "/api/bailu/v1/projects",
        method: "POST",
        body: { contract_version: "bailu.studio/1.0" },
        idempotencyKey: "create-route-1",
        nonce: "YGFiY2RlZmdoaWprbG1ubw",
        claimedBodySha256: "0".repeat(64),
      }),
      runtime,
    );
    expect(response.status).toBe(401);
    expect(sqlite.prepare("SELECT count(*) AS count FROM bailu_service_nonces").get()).toMatchObject({ count: 0 });
    sqlite.close();
  });

  it("returns a stable structured 503 when service identity is absent", async () => {
    const response = studioRouteErrorResponse(new BailuRuntimeConfigError());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      contract_version: "bailu.studio/1.0",
      error_code: "studio_service_not_configured",
      error_summary: "Studio service identity is not configured",
    });
  });
});
