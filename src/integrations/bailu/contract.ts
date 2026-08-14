/**
 * Runtime mirror for the minimum ClipForge-facing surface of the main contract.
 * Source of authority: 多自媒体平台管理中心/src/shared/contracts-studio.ts
 * Locked source SHA-256: 4f27f79e847009411e322420c0f285ae453f925bb22e7db3177c30584ed211d7
 *
 * This file is a strict wire parser/serializer only. It must not grow into a
 * second independently evolving business contract.
 */

export const STUDIO_CONTRACT_VERSION = "bailu.studio/1.0" as const;
export const STUDIO_KIND = "clipforge" as const;

const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;

export type StudioRunState = "running" | "succeeded" | "failed" | "remote_state_unknown";

export interface CreateProjectRequest {
  contract_version: typeof STUDIO_CONTRACT_VERSION;
  studio_project_binding_id: string;
  title: string;
}

export interface CreateProjectResponse {
  contract_version: typeof STUDIO_CONTRACT_VERSION;
  external_project_id: string;
  external_revision: null;
  state: "active";
}

export interface ComposeOptions {
  resolution?: "720p" | "1080p";
  aspect_ratio?: "9:16" | "16:9" | "1:1";
  render_preset?: "fast" | "standard" | "hd";
  caption_preset?: "standard" | "bold" | "minimal" | "karaoke";
  aigc_badge?: boolean;
  free_tts?: boolean;
  free_bgm?: boolean;
  bgm_duck?: boolean;
  voice_ground?: boolean;
  product_card?: boolean;
  cta_text?: string;
  label?: string;
}

export interface RunRequest {
  contract_version: typeof STUDIO_CONTRACT_VERSION;
  studio_run_id: string;
  operation: "compose";
  input_sha256: string;
  options: ComposeOptions;
}

export interface RunAcceptedResponse {
  contract_version: typeof STUDIO_CONTRACT_VERSION;
  studio_run_id: string;
  external_task_id: string;
  state: "running";
}

export interface StudioOutputManifestItem {
  output_id: string;
  role: string;
  relative_path: string;
  content_sha256: string;
  size_bytes: number;
  mime_type: string;
}

export interface RunStatusResponse {
  contract_version: typeof STUDIO_CONTRACT_VERSION;
  studio_run_id: string;
  external_task_id: string;
  state: StudioRunState;
  outputs: StudioOutputManifestItem[];
  error_code: string | null;
  error_summary: string | null;
}

export interface ServiceErrorResponse {
  contract_version: typeof STUDIO_CONTRACT_VERSION;
  error_code: string;
  error_summary: string;
}

const CREATE_KEYS = new Set(["contract_version", "studio_project_binding_id", "title"]);
const RUN_KEYS = new Set(["contract_version", "studio_run_id", "operation", "input_sha256", "options"]);
const OPTION_KEYS = new Set([
  "resolution",
  "aspect_ratio",
  "render_preset",
  "caption_preset",
  "aigc_badge",
  "free_tts",
  "free_bgm",
  "bgm_duck",
  "voice_ground",
  "product_card",
  "cta_text",
  "label",
]);

export class StudioContractError extends Error {
  readonly code = "studio_request_invalid";

  constructor() {
    super("studio_request_invalid");
    this.name = "StudioContractError";
  }
}

function invalid(): never {
  throw new StudioContractError();
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): void {
  if (Object.keys(value).some((key) => !allowed.has(key)) || Object.keys(value).length !== allowed.size) invalid();
}

function optionalEnum<T extends string>(value: unknown, allowed: readonly T[]): value is T | undefined {
  return value === undefined || (typeof value === "string" && allowed.includes(value as T));
}

function optionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === "boolean";
}

export function parseCreateProjectRequest(value: unknown): CreateProjectRequest {
  const row = record(value);
  exactKeys(row, CREATE_KEYS);
  if (row.contract_version !== STUDIO_CONTRACT_VERSION) invalid();
  if (typeof row.studio_project_binding_id !== "string" || !TOKEN.test(row.studio_project_binding_id)) invalid();
  if (typeof row.title !== "string" || row.title.trim().length === 0 || row.title.length > 200) invalid();
  return {
    contract_version: STUDIO_CONTRACT_VERSION,
    studio_project_binding_id: row.studio_project_binding_id,
    title: row.title.trim(),
  };
}

export function parseRunRequest(value: unknown): RunRequest {
  const row = record(value);
  exactKeys(row, RUN_KEYS);
  if (row.contract_version !== STUDIO_CONTRACT_VERSION) invalid();
  if (typeof row.studio_run_id !== "string" || !TOKEN.test(row.studio_run_id)) invalid();
  if (row.operation !== "compose") invalid();
  if (typeof row.input_sha256 !== "string" || !SHA256.test(row.input_sha256)) invalid();

  const options = record(row.options);
  if (Object.keys(options).some((key) => !OPTION_KEYS.has(key))) invalid();
  if (!optionalEnum(options.resolution, ["720p", "1080p"] as const)) invalid();
  if (!optionalEnum(options.aspect_ratio, ["9:16", "16:9", "1:1"] as const)) invalid();
  if (!optionalEnum(options.render_preset, ["fast", "standard", "hd"] as const)) invalid();
  if (!optionalEnum(options.caption_preset, ["standard", "bold", "minimal", "karaoke"] as const)) invalid();
  for (const key of ["aigc_badge", "free_tts", "free_bgm", "bgm_duck", "voice_ground", "product_card"] as const) {
    if (!optionalBoolean(options[key])) invalid();
  }
  if (options.cta_text !== undefined && (typeof options.cta_text !== "string" || options.cta_text.length > 200)) invalid();
  if (options.label !== undefined && (typeof options.label !== "string" || options.label.length > 60)) invalid();

  return {
    contract_version: STUDIO_CONTRACT_VERSION,
    studio_run_id: row.studio_run_id,
    operation: "compose",
    input_sha256: row.input_sha256,
    options: options as ComposeOptions,
  };
}

export function composeOptionsToExistingBody(options: ComposeOptions): Record<string, unknown> {
  return {
    ...(options.resolution !== undefined && { resolution: options.resolution }),
    ...(options.aspect_ratio !== undefined && { aspectRatio: options.aspect_ratio }),
    ...(options.render_preset !== undefined && { renderPreset: options.render_preset }),
    ...(options.caption_preset !== undefined && { captionPreset: options.caption_preset }),
    ...(options.aigc_badge !== undefined && { aigcBadge: options.aigc_badge }),
    ...(options.free_tts !== undefined && { freeTts: { enabled: options.free_tts } }),
    ...(options.free_bgm !== undefined && { freeBgm: options.free_bgm }),
    ...(options.bgm_duck !== undefined && { bgmDuck: options.bgm_duck }),
    ...(options.voice_ground !== undefined && { voiceGround: options.voice_ground }),
    ...(options.product_card !== undefined && { productCard: options.product_card }),
    ...(options.cta_text !== undefined && { ctaText: options.cta_text }),
    ...(options.label !== undefined && { label: options.label }),
  };
}
