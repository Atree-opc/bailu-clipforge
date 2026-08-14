import { createHash } from "crypto";
import { spawn } from "child_process";
import { constants } from "fs";
import { lstat, open, realpath, type FileHandle } from "fs/promises";
import { isAbsolute, relative, sep } from "path";
import { once } from "events";
import { pipeline } from "stream/promises";
import { ffprobeBin } from "@/lib/ffmpeg-path";
import { parseMediaProbeJson, type MediaProbe } from "@/lib/media-probe";
import type { StudioOutputManifestItem } from "./contract";

const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

interface OutputManifestProbeSource {
  handle: FileHandle;
  sizeBytes: number;
}

interface OutputManifestDependencies {
  probeMedia(source: OutputManifestProbeSource): Promise<MediaProbe>;
}

interface FileIdentity {
  dev: bigint;
  ino: bigint;
  nlink: bigint;
  size: bigint;
  mtimeNs: bigint;
  ctimeNs: bigint;
  regular: boolean;
  symlink: boolean;
}

interface BigIntStatLike {
  dev: bigint;
  ino: bigint;
  nlink: bigint;
  size: bigint;
  mtimeNs: bigint;
  ctimeNs: bigint;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

export class BailuOutputError extends Error {
  readonly code = "studio_output_invalid";

  constructor() {
    super("studio_output_invalid");
    this.name = "BailuOutputError";
  }
}

function invalid(): never {
  throw new BailuOutputError();
}

function identity(stats: BigIntStatLike): FileIdentity {
  return {
    dev: stats.dev,
    ino: stats.ino,
    nlink: stats.nlink,
    size: stats.size,
    mtimeNs: stats.mtimeNs,
    ctimeNs: stats.ctimeNs,
    regular: stats.isFile(),
    symlink: stats.isSymbolicLink(),
  };
}

function sameStableFile(left: FileIdentity, right: FileIdentity): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs &&
    left.regular === right.regular &&
    left.symlink === right.symlink
  );
}

function assertCandidate(candidate: FileIdentity): void {
  if (
    candidate.symlink ||
    !candidate.regular ||
    candidate.nlink !== BigInt(1) ||
    candidate.size <= BigInt(0) ||
    candidate.size > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    invalid();
  }
}

async function pathIdentity(filePath: string): Promise<FileIdentity> {
  return identity((await lstat(filePath, { bigint: true }).catch(invalid)) as unknown as BigIntStatLike);
}

async function handleIdentity(handle: FileHandle): Promise<FileIdentity> {
  return identity((await handle.stat({ bigint: true }).catch(invalid)) as unknown as BigIntStatLike);
}

async function assertPathAndHandleStable(
  filePath: string,
  handle: FileHandle,
  expected: FileIdentity,
): Promise<void> {
  const [pathNow, handleNow] = await Promise.all([pathIdentity(filePath), handleIdentity(handle)]);
  assertCandidate(pathNow);
  assertCandidate(handleNow);
  if (!sameStableFile(expected, pathNow) || !sameStableFile(expected, handleNow)) invalid();
}

async function assertIsoBmffFtyp(handle: FileHandle, sizeBytes: number): Promise<void> {
  const header = Buffer.alloc(16);
  const { bytesRead } = await handle.read(header, 0, header.length, 0).catch(invalid);
  if (bytesRead < 12 || header.toString("ascii", 4, 8) !== "ftyp") invalid();
  const boxSize = header.readUInt32BE(0);
  if (boxSize < 12 || boxSize > sizeBytes) invalid();
}

async function hashOpenFile(handle: FileHandle, expectedSize: number): Promise<string> {
  const hash = createHash("sha256");
  let observed = 0;
  const stream = handle.createReadStream({ autoClose: false, start: 0, end: expectedSize - 1 });
  for await (const chunk of stream) {
    const bytes = chunk as Buffer;
    observed += bytes.length;
    hash.update(bytes);
  }
  if (observed !== expectedSize) invalid();
  return hash.digest("hex");
}

async function collectOutput(stream: NodeJS.ReadableStream, maxBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let observed = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    observed += bytes.length;
    if (observed > maxBytes) throw new Error("ffprobe output exceeded limit");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function probeOpenFile(source: OutputManifestProbeSource): Promise<MediaProbe> {
  const child = spawn(
    ffprobeBin(),
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-show_entries",
      "stream=codec_type,width,height",
      "-of",
      "json",
      "pipe:0",
    ],
    { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
  );
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, 30_000);
  try {
    const input = source.handle.createReadStream({ autoClose: false, start: 0, end: source.sizeBytes - 1 });
    let observed = 0;
    input.on("data", (chunk: string | Buffer) => {
      observed += Buffer.byteLength(chunk);
    });
    const [, stdout, stderr, closed] = await Promise.all([
      pipeline(input, child.stdin),
      collectOutput(child.stdout, 4 * 1024 * 1024),
      collectOutput(child.stderr, 512 * 1024),
      once(child, "close"),
    ]);
    const [code, signal] = closed as [number | null, NodeJS.Signals | null];
    if (timedOut || code !== 0 || signal !== null || observed !== source.sizeBytes) {
      throw new Error(stderr || "ffprobe failed");
    }
    return parseMediaProbeJson(stdout);
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
}

function assertRealVideo(probe: MediaProbe): void {
  if (
    !Number.isFinite(probe.duration) ||
    probe.duration <= 0 ||
    !Number.isSafeInteger(probe.width) ||
    probe.width <= 0 ||
    !Number.isSafeInteger(probe.height) ||
    probe.height <= 0
  ) {
    invalid();
  }
}

export function createOutputManifestBuilder(
  overrides: Partial<OutputManifestDependencies> = {},
): (outputRoot: string, compositionId: string, outputPath: string) => Promise<StudioOutputManifestItem[]> {
  const dependencies: OutputManifestDependencies = {
    probeMedia: overrides.probeMedia ?? probeOpenFile,
  };

  return async (outputRoot, compositionId, outputPath) => {
    if (!TOKEN.test(compositionId) || !outputPath.toLowerCase().endsWith(".mp4")) invalid();
    const root = await realpath(outputRoot).catch(invalid);
    const initialPath = await pathIdentity(outputPath);
    assertCandidate(initialPath);

    const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
    const handle = await open(outputPath, constants.O_RDONLY | noFollow).catch(invalid);
    try {
      const initialHandle = await handleIdentity(handle);
      assertCandidate(initialHandle);
      if (!sameStableFile(initialPath, initialHandle)) invalid();

      const file = await realpath(outputPath).catch(invalid);
      const relativeNative = relative(root, file);
      if (!relativeNative || relativeNative === ".." || relativeNative.startsWith(`..${sep}`) || isAbsolute(relativeNative)) {
        invalid();
      }
      const relativePath = relativeNative.split(sep).join("/");
      if (
        relativePath.includes("\\") ||
        relativePath.startsWith("/") ||
        relativePath.split("/").some((part) => !part || part === "." || part === "..")
      ) {
        invalid();
      }

      const sizeBytes = Number(initialHandle.size);
      await assertIsoBmffFtyp(handle, sizeBytes);
      const firstHash = await hashOpenFile(handle, sizeBytes);
      await assertPathAndHandleStable(outputPath, handle, initialHandle);

      const probe = await dependencies.probeMedia({ handle, sizeBytes }).catch(invalid);
      assertRealVideo(probe);
      await assertPathAndHandleStable(outputPath, handle, initialHandle);

      const secondHash = await hashOpenFile(handle, sizeBytes);
      if (secondHash !== firstHash) invalid();
      await assertPathAndHandleStable(outputPath, handle, initialHandle);

      return [
        {
          output_id: compositionId,
          role: "final_video",
          relative_path: relativePath,
          content_sha256: firstHash,
          size_bytes: sizeBytes,
          mime_type: "video/mp4",
        },
      ];
    } finally {
      await handle.close().catch(() => undefined);
    }
  };
}

export const buildOutputManifest = createOutputManifestBuilder();
