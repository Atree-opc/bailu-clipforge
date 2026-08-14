import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createHash } from "crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { verifySignedRequest, type BailuServiceCredentials } from "../auth";
import { BailuCallbackDelivery } from "../callback";
import type { ComposeAdapter, CompositionLifecycleHooks, CompositionSnapshot } from "../compose-adapter";
import { buildOutputManifest } from "../manifest";
import { BailuServiceLedger } from "../ledger";
import { BailuStudioService } from "../service";

const roots: string[] = [];
const credentials: BailuServiceCredentials = { keyId: "main-local", secret: "callback-test-secret" };

class FakeComposeAdapter implements ComposeAdapter {
  starts = 0;
  hooks: CompositionLifecycleHooks | null = null;
  snapshots = new Map<string, CompositionSnapshot>();
  responseStatus = 202;

  async start(_externalProjectId: string, _options: Record<string, unknown>, hooks: CompositionLifecycleHooks) {
    this.starts += 1;
    this.hooks = hooks;
    if (this.responseStatus === 202) await hooks.onCreated("composition-1");
    return { accepted: this.responseStatus === 202, status: this.responseStatus };
  }

  async get(compositionId: string): Promise<CompositionSnapshot | null> {
    return this.snapshots.get(compositionId) ?? null;
  }
}

function setup(callbackUrl?: string, fetchImpl: typeof fetch = vi.fn()): {
  sqlite: Database.Database;
  outputRoot: string;
  ledger: BailuServiceLedger;
  compose: FakeComposeAdapter;
  service: BailuStudioService;
} {
  const sqlite = new Database(":memory:");
  migrate(drizzle(sqlite), { migrationsFolder: resolve(process.cwd(), "drizzle") });
  const outputRoot = mkdtempSync(join(tmpdir(), "bailu-output-"));
  roots.push(outputRoot);
  const ledger = new BailuServiceLedger(sqlite);
  const compose = new FakeComposeAdapter();
  const callback = new BailuCallbackDelivery(ledger, { credentials, callbackUrl, fetchImpl, nowSeconds: () => 1_800_000_000 });
  const service = new BailuStudioService({ ledger, compose, callback, outputRoot });
  return { sqlite, outputRoot, ledger, compose, service };
}

function create(service: BailuStudioService): string {
  return service.createProject(
    { idempotencyKey: "create-1", requestSha256: "a".repeat(64) },
    { contract_version: "bailu.studio/1.0", studio_project_binding_id: "binding-1", title: "商品短片" },
  ).external_project_id;
}

function runRequest() {
  return {
    contract_version: "bailu.studio/1.0" as const,
    studio_run_id: "studio-run-1",
    operation: "compose" as const,
    input_sha256: "b".repeat(64),
    options: {},
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("terminal output manifest", () => {
  it("emits only output-root-relative POSIX paths with real bytes/hash/size", async () => {
    const root = mkdtempSync(join(tmpdir(), "bailu-manifest-"));
    roots.push(root);
    const projectDir = join(root, "project-1");
    mkdirSync(projectDir);
    const file = join(projectDir, "final.mp4");
    writeFileSync(file, Buffer.from([0, 1, 2, 3]));
    expect(await buildOutputManifest(root, "composition-1", file)).toEqual([
      {
        output_id: "composition-1",
        role: "final_video",
        relative_path: "project-1/final.mp4",
        content_sha256: createHash("sha256").update(Buffer.from([0, 1, 2, 3])).digest("hex"),
        size_bytes: 4,
        mime_type: "video/mp4",
      },
    ]);
  });

  it("rejects root escape, wrong media type, and empty files", async () => {
    const root = mkdtempSync(join(tmpdir(), "bailu-manifest-"));
    const outside = mkdtempSync(join(tmpdir(), "bailu-outside-"));
    roots.push(root, outside);
    const escaped = join(outside, "final.mp4");
    const wrongType = join(root, "final.mov");
    const empty = join(root, "empty.mp4");
    writeFileSync(escaped, "video");
    writeFileSync(wrongType, "video");
    writeFileSync(empty, "");
    await expect(buildOutputManifest(root, "composition-1", escaped)).rejects.toThrow("studio_output_invalid");
    await expect(buildOutputManifest(root, "composition-1", wrongType)).rejects.toThrow("studio_output_invalid");
    await expect(buildOutputManifest(root, "composition-1", empty)).rejects.toThrow("studio_output_invalid");
  });
});

describe("signed service execution", () => {
  it("replays create/run without a second project or compose", async () => {
    const { sqlite, service, compose } = setup();
    const externalProjectId = create(service);
    expect(create(service)).toBe(externalProjectId);
    const accepted = await service.startRun(
      externalProjectId,
      { idempotencyKey: "run-1", requestSha256: "c".repeat(64) },
      runRequest(),
    );
    const replay = await service.startRun(
      externalProjectId,
      { idempotencyKey: "run-1", requestSha256: "c".repeat(64) },
      runRequest(),
    );
    expect(replay).toEqual(accepted);
    expect(compose.starts).toBe(1);
    expect(sqlite.prepare("SELECT count(*) AS count FROM projects").get()).toMatchObject({ count: 1 });
    sqlite.close();
  });

  it("classifies an existing compose rejection without leaking its internal body", async () => {
    const { sqlite, service, compose } = setup();
    const externalProjectId = create(service);
    compose.responseStatus = 400;
    await expect(
      service.startRun(
        externalProjectId,
        { idempotencyKey: "run-1", requestSha256: "c".repeat(64) },
        runRequest(),
      ),
    ).rejects.toMatchObject({ code: "studio_compose_rejected", status: 422 });
    const row = sqlite
      .prepare("SELECT state, terminal_payload, callback_status FROM bailu_service_requests WHERE request_kind = 'compose'")
      .get() as { state: string; terminal_payload: string; callback_status: string };
    expect(row.state).toBe("failed");
    expect(row.terminal_payload).not.toContain("network");
    expect(row.callback_status).toBe("not_configured");
    expect(compose.starts).toBe(1);
    sqlite.close();
  });

  it("persists success before best-effort signed callback and remains pollable when delivery fails", async () => {
    const callbackRequests: Request[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      callbackRequests.push(new Request(input, init));
      throw new Error("network details must not escape");
    }) as unknown as typeof fetch;
    const { sqlite, outputRoot, service, compose, ledger } = setup(
      "http://127.0.0.1/api/studios/runs/callback",
      fetchImpl,
    );
    const externalProjectId = create(service);
    const accepted = await service.startRun(
      externalProjectId,
      { idempotencyKey: "run-1", requestSha256: "c".repeat(64) },
      runRequest(),
    );
    const projectDir = join(outputRoot, externalProjectId);
    mkdirSync(projectDir);
    const outputPath = join(projectDir, "final.mp4");
    writeFileSync(outputPath, "real-video-bytes");
    await compose.hooks?.onTerminal("composition-1", "done", outputPath);

    const status = await service.getRun(accepted.external_task_id);
    expect(status).toMatchObject({ state: "succeeded", error_code: null, outputs: [{ relative_path: expect.stringContaining("/final.mp4") }] });
    expect(status.outputs[0]).not.toHaveProperty("outputPath");
    expect(JSON.stringify(status)).not.toContain(outputRoot);
    expect(callbackRequests).toHaveLength(1);
    const verifiedCallback = await verifySignedRequest(callbackRequests[0], credentials, { nowSeconds: 1_800_000_000 });
    expect(JSON.parse(verifiedCallback.rawBody)).toEqual(status);
    expect(ledger.getRunByExternalTaskId(accepted.external_task_id)).toMatchObject({
      callbackStatus: "failed",
      callbackLastErrorCode: "callback_delivery_failed",
      terminalPayload: expect.objectContaining({ state: "succeeded" }),
    });
    sqlite.close();
  });

  it("persists a stable failed terminal status and signs a successful callback delivery", async () => {
    const callbackRequests: Request[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      callbackRequests.push(new Request(input, init));
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const { sqlite, service, compose, ledger } = setup(
      "http://127.0.0.1/api/studios/runs/callback",
      fetchImpl,
    );
    const externalProjectId = create(service);
    const accepted = await service.startRun(
      externalProjectId,
      { idempotencyKey: "run-1", requestSha256: "c".repeat(64) },
      runRequest(),
    );
    await compose.hooks?.onTerminal("composition-1", "failed");

    const status = await service.getRun(accepted.external_task_id);
    expect(status).toEqual({
      contract_version: "bailu.studio/1.0",
      studio_run_id: "studio-run-1",
      external_task_id: accepted.external_task_id,
      state: "failed",
      outputs: [],
      error_code: "studio_compose_failed",
      error_summary: "Composition failed",
    });
    expect(callbackRequests).toHaveLength(1);
    const verified = await verifySignedRequest(callbackRequests[0], credentials, { nowSeconds: 1_800_000_000 });
    expect(JSON.parse(verified.rawBody)).toEqual(status);
    expect(ledger.getRunByExternalTaskId(accepted.external_task_id)).toMatchObject({ callbackStatus: "delivered" });
    sqlite.close();
  });

  it("recovers terminal composition state after a service restart without recomposing", async () => {
    const { sqlite, outputRoot, service, compose, ledger } = setup();
    const externalProjectId = create(service);
    const accepted = await service.startRun(
      externalProjectId,
      { idempotencyKey: "run-1", requestSha256: "c".repeat(64) },
      runRequest(),
    );
    const projectDir = join(outputRoot, externalProjectId);
    mkdirSync(projectDir);
    const outputPath = join(projectDir, "final.mp4");
    writeFileSync(outputPath, "restart-video");
    compose.snapshots.set("composition-1", { status: "done", outputPath });

    const restartedCompose = new FakeComposeAdapter();
    restartedCompose.snapshots = compose.snapshots;
    const restarted = new BailuStudioService({
      ledger: new BailuServiceLedger(sqlite),
      compose: restartedCompose,
      callback: new BailuCallbackDelivery(ledger, { credentials }),
      outputRoot,
    });
    expect(await restarted.getRun(accepted.external_task_id)).toMatchObject({ state: "succeeded" });
    expect(restartedCompose.starts).toBe(0);
    sqlite.close();
  });
});
