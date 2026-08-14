import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createHash } from "crypto";
import {
  closeSync,
  copyFileSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  writeSync,
} from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { verifySignedRequest, type BailuServiceCredentials } from "../auth";
import { BailuCallbackDelivery, parseFixedCallbackUrl } from "../callback";
import type { ComposeAdapter, CompositionLifecycleHooks, CompositionSnapshot } from "../compose-adapter";
import { createOutputManifestBuilder, buildOutputManifest } from "../manifest";
import { BailuServiceLedger } from "../ledger";
import { BailuStudioService } from "../service";
import { probeMedia } from "@/lib/media-probe";
import { generateRealMp4 } from "./real-mp4";

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
  it("accepts a real ISO-BMFF video and emits its exact bytes/hash/size", async () => {
    const root = mkdtempSync(join(tmpdir(), "bailu-manifest-"));
    roots.push(root);
    const projectDir = join(root, "project-1");
    mkdirSync(projectDir);
    const file = join(projectDir, "final.mp4");
    generateRealMp4(file);
    const bytes = readFileSync(file);
    expect(await buildOutputManifest(root, "composition-1", file)).toEqual([
      {
        output_id: "composition-1",
        role: "final_video",
        relative_path: "project-1/final.mp4",
        content_sha256: createHash("sha256").update(bytes).digest("hex"),
        size_bytes: bytes.length,
        mime_type: "video/mp4",
      },
    ]);
  });

  it("binds media verification to the already opened source handle", async () => {
    const root = mkdtempSync(join(tmpdir(), "bailu-manifest-"));
    roots.push(root);
    const file = join(root, "handle-bound.mp4");
    generateRealMp4(file);
    let receivedHandle = false;
    const builder = createOutputManifestBuilder({
      probeMedia: async (source) => {
        receivedHandle = typeof source.handle.fd === "number" && source.sizeBytes > 0;
        return probeMedia(file);
      },
    });
    await expect(builder(root, "composition-handle", file)).resolves.toHaveLength(1);
    expect(receivedHandle).toBe(true);
  });

  it("rejects an ftyp-shaped fake with no real video stream", async () => {
    const root = mkdtempSync(join(tmpdir(), "bailu-manifest-"));
    roots.push(root);
    const fake = join(root, "fake.mp4");
    const bytes = Buffer.alloc(24);
    bytes.writeUInt32BE(24, 0);
    bytes.write("ftyp", 4, "ascii");
    bytes.write("isom", 8, "ascii");
    writeFileSync(fake, bytes);
    await expect(buildOutputManifest(root, "composition-1", fake)).rejects.toThrow("studio_output_invalid");
  });

  it("rejects hardlinks, symlinks, and non-regular .mp4 paths", async () => {
    const root = mkdtempSync(join(tmpdir(), "bailu-manifest-"));
    const outside = mkdtempSync(join(tmpdir(), "bailu-outside-"));
    roots.push(root, outside);
    const source = join(outside, "source.mp4");
    generateRealMp4(source);
    const hardlink = join(root, "hardlink.mp4");
    const symlink = join(root, "symlink.mp4");
    const directory = join(root, "directory.mp4");
    linkSync(source, hardlink);
    // Windows permits a junction without developer-mode symlink privileges; lstat
    // still reports it as a symbolic link, exercising the production rejection.
    symlinkSync(outside, symlink, "junction");
    mkdirSync(directory);
    await expect(buildOutputManifest(root, "composition-1", hardlink)).rejects.toThrow("studio_output_invalid");
    await expect(buildOutputManifest(root, "composition-1", symlink)).rejects.toThrow("studio_output_invalid");
    await expect(buildOutputManifest(root, "composition-1", directory)).rejects.toThrow("studio_output_invalid");
  });

  it("rejects path swaps and same-inode byte drift during verification", async () => {
    const root = mkdtempSync(join(tmpdir(), "bailu-manifest-"));
    roots.push(root);
    const swap = join(root, "swap.mp4");
    const original = join(root, "swap-original.mp4");
    generateRealMp4(swap);
    const swapBuilder = createOutputManifestBuilder({
      probeMedia: async () => {
        renameSync(swap, original);
        copyFileSync(original, swap);
        return probeMedia(swap);
      },
    });
    await expect(swapBuilder(root, "composition-swap", swap)).rejects.toThrow("studio_output_invalid");

    const drift = join(root, "drift.mp4");
    generateRealMp4(drift);
    const driftBuilder = createOutputManifestBuilder({
      probeMedia: async () => {
        const media = await probeMedia(drift);
        const descriptor = openSync(drift, "r+");
        const byte = Buffer.alloc(1);
        const offset = Math.max(16, readFileSync(drift).length - 1);
        readSync(descriptor, byte, 0, 1, offset);
        byte[0] ^= 0xff;
        writeSync(descriptor, byte, 0, 1, offset);
        closeSync(descriptor);
        return media;
      },
    });
    await expect(driftBuilder(root, "composition-drift", drift)).rejects.toThrow("studio_output_invalid");
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

describe("fixed callback URL", () => {
  it.each([
    " http://127.0.0.1/callback",
    "http://127.0.0.1/callback ",
    "http://127.0.0.1/callback?",
    "http://127.0.0.1/callback?mode=terminal",
    "http://127.0.0.1/callback#",
    "http://127.0.0.1/callback#terminal",
  ])("rejects raw URL variation %s", (value) => {
    expect(parseFixedCallbackUrl(value)).toBeNull();
  });

  it("accepts one exact HTTP(S) URL without credentials/query/hash", () => {
    expect(parseFixedCallbackUrl("http://127.0.0.1/api/studios/runs/callback")?.href).toBe(
      "http://127.0.0.1/api/studios/runs/callback",
    );
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
    generateRealMp4(outputPath);
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
    generateRealMp4(outputPath);
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
