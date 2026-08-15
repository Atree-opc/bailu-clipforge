import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createHash } from "crypto";
import { execFileSync } from "child_process";
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { basename, join, relative, resolve, sep } from "path";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { BAILU_AUTH_HEADERS, signBailuRequest, type BailuServiceCredentials } from "../auth";
import { BailuCallbackDelivery } from "../callback";
import type { ComposeAdapter } from "../compose-adapter";
import type { RunStatusResponse, StudioOutputManifestItem } from "../contract";
import { BailuServiceLedger } from "../ledger";
import { buildOutputManifest, openVerifiedOutputContent } from "../manifest";
import { handleGetRunOutputContent } from "../route-handler";
import type { BailuServiceRuntime } from "../runtime";
import { BailuStudioService } from "../service";
import { ffmpegBin } from "@/lib/ffmpeg-path";
import { generateRealMp4 } from "./real-mp4";

const credentials: BailuServiceCredentials = { keyId: "main-local", secret: "content-route-test-secret" };
const roots: string[] = [];
let nonceCounter = 0;

class NoopComposeAdapter implements ComposeAdapter {
  async start() {
    return { accepted: false, status: 500 };
  }

  async get() {
    return null;
  }
}

interface TestContext {
  sqlite: Database.Database;
  outputRoot: string;
  ledger: BailuServiceLedger;
  runtime: BailuServiceRuntime;
}

function setup(): TestContext {
  const sqlite = new Database(":memory:");
  migrate(drizzle(sqlite), { migrationsFolder: resolve(process.cwd(), "drizzle") });
  const outputRoot = mkdtempSync(join(tmpdir(), "bailu-content-output-"));
  roots.push(outputRoot);
  const ledger = new BailuServiceLedger(sqlite);
  const service = new BailuStudioService({
    ledger,
    compose: new NoopComposeAdapter(),
    callback: new BailuCallbackDelivery(ledger, { credentials }),
    outputRoot,
  });
  return { sqlite, outputRoot, ledger, runtime: { credentials, service } };
}

function nextNonce(): string {
  const bytes = Buffer.alloc(16);
  bytes.writeUInt32BE(++nonceCounter, 12);
  return bytes.toString("base64url");
}

function contentPath(externalTaskId: string, outputId: string): string {
  return `/api/bailu/v1/runs/${externalTaskId}/outputs/${outputId}/content`;
}

function signedContentRequest(input: {
  externalTaskId: string;
  outputId: string;
  nonce?: string;
  idempotencyKey?: string;
  timestamp?: number;
  secret?: string;
  urlSuffix?: string;
  rawUrlSuffix?: string;
  simulatedRawBody?: string;
  headers?: Record<string, string>;
}): Request {
  const pathname = contentPath(input.externalTaskId, input.outputId);
  const timestamp = input.timestamp ?? Math.floor(Date.now() / 1000);
  const nonce = input.nonce ?? nextNonce();
  const idempotencyKey = input.idempotencyKey ?? `content-${input.externalTaskId}-${input.outputId}-${nonceCounter}`;
  const bodySha256 = createHash("sha256").update(input.simulatedRawBody ?? "").digest("hex");
  const signature = signBailuRequest(
    { method: "GET", pathname, timestamp, nonce, idempotencyKey, bodySha256 },
    { keyId: credentials.keyId, secret: input.secret ?? credentials.secret },
  );
  const request = new Request(`http://127.0.0.1${pathname}${input.urlSuffix ?? ""}`, {
    headers: {
      [BAILU_AUTH_HEADERS.keyId]: credentials.keyId,
      [BAILU_AUTH_HEADERS.timestamp]: String(timestamp),
      [BAILU_AUTH_HEADERS.nonce]: nonce,
      [BAILU_AUTH_HEADERS.idempotencyKey]: idempotencyKey,
      [BAILU_AUTH_HEADERS.bodySha256]: bodySha256,
      [BAILU_AUTH_HEADERS.signature]: signature,
      ...input.headers,
    },
  });
  if (input.rawUrlSuffix !== undefined) {
    Object.defineProperty(request, "url", { value: `http://127.0.0.1${pathname}${input.rawUrlSuffix}` });
  }
  if (input.simulatedRawBody !== undefined) {
    Object.defineProperty(request, "text", { value: async () => input.simulatedRawBody });
  }
  return request;
}

function seedRun(context: TestContext, suffix: string): { externalProjectId: string; externalTaskId: string; studioRunId: string } {
  const project = context.ledger.createProjectIdempotent({
    idempotencyKey: `create-${suffix}`,
    requestSha256: createHash("sha256").update(`create-${suffix}`).digest("hex"),
    title: `Project ${suffix}`,
  });
  const externalTaskId = `task-${suffix}`;
  const studioRunId = `studio-run-${suffix}`;
  context.ledger.beginRunIdempotent({
    idempotencyKey: `run-${suffix}`,
    requestSha256: createHash("sha256").update(`run-${suffix}`).digest("hex"),
    studioRunId,
    externalProjectId: project.externalProjectId,
    externalTaskId,
  });
  context.ledger.bindComposition(externalTaskId, `composition-${suffix}`);
  return { externalProjectId: project.externalProjectId, externalTaskId, studioRunId };
}

function posixRelative(root: string, file: string): string {
  return relative(root, file).split(sep).join("/");
}

function manifestFor(
  root: string,
  file: string,
  outputId: string,
  overrides: Partial<StudioOutputManifestItem> = {},
): StudioOutputManifestItem {
  const bytes = readFileSync(file);
  return {
    output_id: outputId,
    role: "final_video",
    relative_path: posixRelative(root, file),
    content_sha256: createHash("sha256").update(bytes).digest("hex"),
    size_bytes: bytes.length,
    mime_type: "video/mp4",
    ...overrides,
  };
}

function markSucceeded(
  context: TestContext,
  run: ReturnType<typeof seedRun>,
  outputs: StudioOutputManifestItem[],
): RunStatusResponse {
  const payload: RunStatusResponse = {
    contract_version: "bailu.studio/1.0",
    studio_run_id: run.studioRunId,
    external_task_id: run.externalTaskId,
    state: "succeeded",
    outputs,
    error_code: null,
    error_summary: null,
  };
  context.ledger.markTerminal(run.externalTaskId, payload);
  return payload;
}

function generateLargeRealMp4(file: string): void {
  execFileSync(
    ffmpegBin(),
    [
      "-v", "error", "-f", "lavfi", "-i", "nullsrc=s=640x640:r=2:d=1,geq=random(1)*255:128:128", "-an",
      "-c:v", "libx264", "-preset", "ultrafast", "-crf", "0", "-pix_fmt", "yuv420p",
      "-movflags", "+faststart", "-y", file,
    ],
    { stdio: "ignore", timeout: 20_000 },
  );
}

async function requestContent(context: TestContext, externalTaskId: string, outputId: string, input: Partial<Parameters<typeof signedContentRequest>[0]> = {}) {
  const request = signedContentRequest({ externalTaskId, outputId, ...input });
  return handleGetRunOutputContent(request, externalTaskId, outputId, context.runtime);
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("signed Bailu output content", () => {
  it("streams a real >1 MiB H.264 MP4 byte-for-byte with the exact transfer headers and no ledger/status mutation", async () => {
    const context = setup();
    const run = seedRun(context, "large");
    const projectDir = join(context.outputRoot, run.externalProjectId);
    mkdirSync(projectDir);
    const file = join(projectDir, "final.mp4");
    generateLargeRealMp4(file);
    const bytes = readFileSync(file);
    expect(bytes.length).toBeGreaterThan(1024 * 1024);
    const [output] = await buildOutputManifest(context.outputRoot, "composition-large", file);
    markSucceeded(context, run, [output]);
    const before = context.sqlite.prepare("SELECT * FROM bailu_service_requests WHERE external_task_id = ?").get(run.externalTaskId);

    const response = await requestContent(context, run.externalTaskId, output.output_id);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(response.headers.get("content-length")).toBe(String(bytes.length));
    expect(response.headers.get("x-bailu-content-sha256")).toBe(output.content_sha256);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("location")).toBeNull();
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    expect(context.sqlite.prepare("SELECT * FROM bailu_service_requests WHERE external_task_id = ?").get(run.externalTaskId)).toEqual(before);
    context.sqlite.close();
  }, 30_000);

  it("requires a valid fresh seven-line signature and persists nonce replay protection only after verification", async () => {
    const context = setup();
    const run = seedRun(context, "auth");
    const file = join(context.outputRoot, "auth.mp4");
    generateRealMp4(file);
    const output = manifestFor(context.outputRoot, file, "composition-auth");
    markSucceeded(context, run, [output]);

    const missing = await handleGetRunOutputContent(
      new Request(`http://127.0.0.1${contentPath(run.externalTaskId, output.output_id)}`),
      run.externalTaskId,
      output.output_id,
      context.runtime,
    );
    expect(missing.status).toBe(401);
    const missingWithRange = await handleGetRunOutputContent(
      new Request(`http://127.0.0.1${contentPath(run.externalTaskId, output.output_id)}`, {
        headers: { range: "bytes=0-9" },
      }),
      run.externalTaskId,
      output.output_id,
      context.runtime,
    );
    expect(missingWithRange.status).toBe(400);
    expect(await missingWithRange.json()).toMatchObject({ error_code: "studio_range_not_supported" });
    expect(context.sqlite.prepare("SELECT count(*) AS count FROM bailu_service_nonces").get()).toMatchObject({ count: 0 });

    const wrong = await requestContent(context, run.externalTaskId, output.output_id, { secret: "wrong-secret" });
    expect(wrong.status).toBe(401);
    const expired = await requestContent(context, run.externalTaskId, output.output_id, {
      timestamp: Math.floor(Date.now() / 1000) - 301,
    });
    expect(expired.status).toBe(401);
    expect(context.sqlite.prepare("SELECT count(*) AS count FROM bailu_service_nonces").get()).toMatchObject({ count: 0 });

    const nonce = nextNonce();
    const first = await requestContent(context, run.externalTaskId, output.output_id, { nonce, idempotencyKey: "content-auth" });
    expect(first.status).toBe(200);
    await first.body?.cancel();
    const replay = await requestContent(context, run.externalTaskId, output.output_id, { nonce, idempotencyKey: "content-auth" });
    expect(replay.status).toBe(409);
    expect(await replay.json()).toMatchObject({ error_code: "studio_auth_replayed" });
    expect(context.sqlite.prepare("SELECT count(*) AS count FROM bailu_service_nonces").get()).toMatchObject({ count: 1 });
    context.sqlite.close();
  });

  it("rejects running, failed, unknown task, and unknown output without exposing a locator", async () => {
    const context = setup();
    const running = seedRun(context, "running");
    const failed = seedRun(context, "failed");
    context.ledger.markRunFailed(failed.externalTaskId, "studio_compose_failed", "Composition failed");

    const runningResponse = await requestContent(context, running.externalTaskId, "composition-running");
    expect(runningResponse.status).toBe(409);
    expect(await runningResponse.json()).toMatchObject({ error_code: "studio_output_not_ready" });
    const failedResponse = await requestContent(context, failed.externalTaskId, "composition-failed");
    expect(failedResponse.status).toBe(409);
    expect(await failedResponse.json()).toMatchObject({ error_code: "studio_output_not_ready" });
    const unknownTask = await requestContent(context, "task-missing", "output-missing");
    expect(unknownTask.status).toBe(404);
    expect(await unknownTask.json()).toMatchObject({ error_code: "studio_run_not_found" });

    const succeeded = seedRun(context, "unknown-output");
    const file = join(context.outputRoot, "known.mp4");
    generateRealMp4(file);
    markSucceeded(context, succeeded, [manifestFor(context.outputRoot, file, "known-output")]);
    const unknownOutput = await requestContent(context, succeeded.externalTaskId, "output-missing");
    expect(unknownOutput.status).toBe(404);
    const unknownBody = await unknownOutput.json();
    expect(unknownBody).toMatchObject({ error_code: "studio_output_not_found" });
    expect(JSON.stringify(unknownBody)).not.toContain(context.outputRoot);
    context.sqlite.close();
  });

  it("accepts no client relative_path, traversal, query, Range, redirect, or absolute-path surface", async () => {
    const context = setup();
    const run = seedRun(context, "surface");
    const file = join(context.outputRoot, "surface.mp4");
    generateRealMp4(file);
    const output = manifestFor(context.outputRoot, file, "surface-output");
    markSucceeded(context, run, [output]);

    const terminalBefore = context.sqlite
      .prepare("SELECT * FROM bailu_service_requests WHERE external_task_id = ?")
      .get(run.externalTaskId);
    const query = await requestContent(context, run.externalTaskId, output.output_id, {
      urlSuffix: `?relative_path=${encodeURIComponent(output.relative_path)}`,
    });
    expect(query.status).toBe(400);
    const fragment = await requestContent(context, run.externalTaskId, output.output_id, { rawUrlSuffix: "#fragment" });
    expect(fragment.status).toBe(400);
    const range = await requestContent(context, run.externalTaskId, output.output_id, { headers: { range: "bytes=0-9" } });
    expect(range.status).toBe(400);
    expect(await range.json()).toMatchObject({ error_code: "studio_range_not_supported" });
    const traversal = await handleGetRunOutputContent(
      signedContentRequest({ externalTaskId: run.externalTaskId, outputId: output.output_id }),
      run.externalTaskId,
      "..",
      context.runtime,
    );
    expect(traversal.status).toBe(400);
    for (const response of [query, fragment, traversal]) {
      expect(response.headers.get("location")).toBeNull();
      expect(await response.clone().text()).not.toContain(context.outputRoot);
      expect(await response.text()).not.toContain(credentials.secret);
    }
    expect(context.sqlite.prepare("SELECT count(*) AS count FROM bailu_service_nonces").get()).toMatchObject({ count: 0 });
    expect(context.sqlite.prepare("SELECT * FROM bailu_service_requests WHERE external_task_id = ?").get(run.externalTaskId)).toEqual(
      terminalBefore,
    );
    context.sqlite.close();
  });

  it("treats a bare query delimiter exactly like no query after WHATWG URL normalization", async () => {
    const context = setup();
    const run = seedRun(context, "empty-query-equivalence");
    const file = join(context.outputRoot, "empty-query-equivalence.mp4");
    generateRealMp4(file);
    const output = manifestFor(context.outputRoot, file, "empty-query-equivalence-output");
    markSucceeded(context, run, [output]);
    const terminalBefore = context.sqlite
      .prepare("SELECT * FROM bailu_service_requests WHERE external_task_id = ?")
      .get(run.externalTaskId);

    const noQueryRawRequest = signedContentRequest({ externalTaskId: run.externalTaskId, outputId: output.output_id });
    const emptyQueryRawRequest = signedContentRequest({
      externalTaskId: run.externalTaskId,
      outputId: output.output_id,
      urlSuffix: "?",
    });
    expect(emptyQueryRawRequest.url).toBe(`${noQueryRawRequest.url}?`);
    const noQueryRequest = new NextRequest(noQueryRawRequest.url, { headers: noQueryRawRequest.headers });
    const emptyQueryRequest = new NextRequest(emptyQueryRawRequest.url, { headers: emptyQueryRawRequest.headers });
    expect(emptyQueryRequest.url).toBe(noQueryRequest.url);

    const noQuery = await handleGetRunOutputContent(noQueryRequest, run.externalTaskId, output.output_id, context.runtime);
    const emptyQuery = await handleGetRunOutputContent(emptyQueryRequest, run.externalTaskId, output.output_id, context.runtime);
    expect(emptyQuery.status).toBe(noQuery.status);
    expect(Object.fromEntries(emptyQuery.headers.entries())).toEqual(Object.fromEntries(noQuery.headers.entries()));
    expect(new Uint8Array(await emptyQuery.arrayBuffer())).toEqual(new Uint8Array(await noQuery.arrayBuffer()));
    expect(context.sqlite.prepare("SELECT count(*) AS count FROM bailu_service_nonces").get()).toMatchObject({ count: 2 });
    expect(context.sqlite.prepare("SELECT * FROM bailu_service_requests WHERE external_task_id = ?").get(run.externalTaskId)).toEqual(
      terminalBefore,
    );
    context.sqlite.close();
  });

  it("rejects body transport ambiguity and post-verification non-empty raw bodies before claiming a nonce", async () => {
    const context = setup();
    const run = seedRun(context, "transport");
    const file = join(context.outputRoot, "transport.mp4");
    generateRealMp4(file);
    const output = manifestFor(context.outputRoot, file, "transport-output");
    markSucceeded(context, run, [output]);
    const terminalBefore = context.sqlite
      .prepare("SELECT * FROM bailu_service_requests WHERE external_task_id = ?")
      .get(run.externalTaskId);

    const transportHeaders: Array<Record<string, string>> = [
      { "content-length": "1" },
      { "content-length": "00" },
      { "content-length": "+0" },
      { "transfer-encoding": "chunked" },
      { "transfer-encoding": "identity", "content-length": "0" },
    ];
    for (const headers of transportHeaders) {
      const rejected = await requestContent(context, run.externalTaskId, output.output_id, { headers });
      expect(rejected.status).toBe(400);
      expect(await rejected.json()).toMatchObject({ error_code: "studio_request_invalid" });
    }

    const signedNonEmpty = await requestContent(context, run.externalTaskId, output.output_id, {
      headers: { "content-length": "0" },
      simulatedRawBody: "hidden-body",
    });
    expect(signedNonEmpty.status).toBe(400);
    expect(await signedNonEmpty.json()).toMatchObject({ error_code: "studio_request_invalid" });
    expect(context.sqlite.prepare("SELECT count(*) AS count FROM bailu_service_nonces").get()).toMatchObject({ count: 0 });
    expect(context.sqlite.prepare("SELECT * FROM bailu_service_requests WHERE external_task_id = ?").get(run.externalTaskId)).toEqual(
      terminalBefore,
    );

    const validZero = await requestContent(context, run.externalTaskId, output.output_id, {
      headers: { "content-length": "0" },
    });
    expect(validZero.status).toBe(200);
    await validZero.body?.cancel();
    expect(context.sqlite.prepare("SELECT count(*) AS count FROM bailu_service_nonces").get()).toMatchObject({ count: 1 });
    context.sqlite.close();
  });

  it("rejects symlink/junction, hardlink, and non-file terminal paths", async () => {
    const context = setup();
    const outside = mkdtempSync(join(tmpdir(), "bailu-content-outside-"));
    roots.push(outside);
    const source = join(outside, "source.mp4");
    generateRealMp4(source);

    const junction = join(context.outputRoot, "junction");
    symlinkSync(outside, junction, "junction");
    const hardlink = join(context.outputRoot, "hardlink.mp4");
    linkSync(source, hardlink);
    const directory = join(context.outputRoot, "directory.mp4");
    mkdirSync(directory);

    const cases: Array<[string, StudioOutputManifestItem]> = [
      ["junction", manifestFor(context.outputRoot, join(junction, basename(source)), "output-junction")],
      ["hardlink", manifestFor(context.outputRoot, hardlink, "output-hardlink")],
      ["directory", {
        output_id: "output-directory", role: "final_video", relative_path: posixRelative(context.outputRoot, directory),
        content_sha256: "a".repeat(64), size_bytes: 1, mime_type: "video/mp4",
      }],
    ];
    for (const [label, output] of cases) {
      const run = seedRun(context, label);
      markSucceeded(context, run, [output]);
      const response = await requestContent(context, run.externalTaskId, output.output_id);
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ error_code: "studio_output_invalid" });
    }
    context.sqlite.close();
  });

  it("rejects terminal-after swap, hash drift, size drift, MIME drift, and ftyp-shaped fake video", async () => {
    const context = setup();

    const swap = join(context.outputRoot, "swap.mp4");
    generateRealMp4(swap);
    const swapManifest = manifestFor(context.outputRoot, swap, "output-swap");
    const swapOld = join(context.outputRoot, "swap-old.mp4");
    renameSync(swap, swapOld);
    generateLargeRealMp4(swap);

    const hashDrift = join(context.outputRoot, "hash-drift.mp4");
    generateRealMp4(hashDrift);
    const hashManifest = manifestFor(context.outputRoot, hashDrift, "output-hash");
    const hashBytes = readFileSync(hashDrift);
    hashBytes[hashBytes.length - 1] ^= 0xff;
    writeFileSync(hashDrift, hashBytes);

    const sizeDrift = join(context.outputRoot, "size-drift.mp4");
    generateRealMp4(sizeDrift);
    const sizeManifest = manifestFor(context.outputRoot, sizeDrift, "output-size");
    writeFileSync(sizeDrift, Buffer.concat([readFileSync(sizeDrift), Buffer.from("drift")]));

    const mime = join(context.outputRoot, "mime.mp4");
    generateRealMp4(mime);
    const mimeManifest = manifestFor(context.outputRoot, mime, "output-mime", { mime_type: "application/octet-stream" });

    const fake = join(context.outputRoot, "fake.mp4");
    const fakeBytes = Buffer.alloc(24);
    fakeBytes.writeUInt32BE(24, 0);
    fakeBytes.write("ftyp", 4, "ascii");
    fakeBytes.write("isom", 8, "ascii");
    writeFileSync(fake, fakeBytes);
    const fakeManifest = manifestFor(context.outputRoot, fake, "output-fake");

    for (const [label, output] of [
      ["swap", swapManifest], ["hash-drift", hashManifest], ["size-drift", sizeManifest],
      ["mime", mimeManifest], ["fake", fakeManifest],
    ] as Array<[string, StudioOutputManifestItem]>) {
      const run = seedRun(context, label);
      markSucceeded(context, run, [output]);
      const response = await requestContent(context, run.externalTaskId, output.output_id);
      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body).toMatchObject({ error_code: "studio_output_invalid" });
      expect(response.headers.get("location")).toBeNull();
      expect(JSON.stringify(body)).not.toContain(context.outputRoot);
    }
    context.sqlite.close();
  });

  it("closes the same verified FileHandle when its byte stream is cancelled", async () => {
    const root = mkdtempSync(join(tmpdir(), "bailu-content-cancel-"));
    roots.push(root);
    const file = join(root, "cancel.mp4");
    generateLargeRealMp4(file);
    const output = manifestFor(root, file, "output-cancel");
    const opened = await openVerifiedOutputContent(root, output);
    const reader = opened.createReadableStream().getReader();
    expect((await reader.read()).done).toBe(false);
    await reader.cancel("client cancelled");
    expect(opened.closed).toBe(true);
  });
});
