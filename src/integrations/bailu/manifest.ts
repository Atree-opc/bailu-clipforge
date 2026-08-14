import { createHash } from "crypto";
import { createReadStream } from "fs";
import { lstat, realpath, stat } from "fs/promises";
import { isAbsolute, relative, sep } from "path";
import type { StudioOutputManifestItem } from "./contract";

const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

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

async function hashFile(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export async function buildOutputManifest(
  outputRoot: string,
  compositionId: string,
  outputPath: string,
): Promise<StudioOutputManifestItem[]> {
  if (!TOKEN.test(compositionId) || !outputPath.toLowerCase().endsWith(".mp4")) invalid();
  const root = await realpath(outputRoot).catch(invalid);
  const sourceLstat = await lstat(outputPath).catch(invalid);
  if (sourceLstat.isSymbolicLink()) invalid();
  const file = await realpath(outputPath).catch(invalid);
  const relativeNative = relative(root, file);
  if (!relativeNative || relativeNative === ".." || relativeNative.startsWith(`..${sep}`) || isAbsolute(relativeNative)) invalid();
  const info = await stat(file).catch(invalid);
  if (!info.isFile() || info.size <= 0 || !Number.isSafeInteger(info.size)) invalid();
  const relativePath = relativeNative.split(sep).join("/");
  if (relativePath.includes("\\") || relativePath.startsWith("/") || relativePath.split("/").some((part) => !part || part === "." || part === "..")) invalid();
  return [
    {
      output_id: compositionId,
      role: "final_video",
      relative_path: relativePath,
      content_sha256: await hashFile(file),
      size_bytes: info.size,
      mime_type: "video/mp4",
    },
  ];
}
