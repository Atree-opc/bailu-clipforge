import { createHash } from "crypto";
import { describe, expect, it } from "vitest";
import {
  parseCreateProjectRequest,
  parseRunRequest,
  type CreateProjectRequest,
  type RunRequest,
} from "../contract";
import {
  BAILU_AUTH_HEADERS,
  canonicalSignaturePayload,
  signBailuRequest,
  verifySignedRequest,
  type BailuServiceCredentials,
} from "../auth";

const credentials: BailuServiceCredentials = {
  keyId: "main-local",
  secret: "test-secret-that-never-leaves-this-process",
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function signedRequest(
  body: unknown,
  overrides: Partial<{
    method: string;
    pathname: string;
    timestamp: number;
    nonce: string;
    idempotencyKey: string;
    keyId: string;
    secret: string;
    bodyText: string;
    bodySha256: string;
  }> = {},
): Promise<Request> {
  const bodyText = overrides.bodyText ?? JSON.stringify(body);
  const method = overrides.method ?? "POST";
  const pathname = overrides.pathname ?? "/api/bailu/v1/projects";
  const timestamp = overrides.timestamp ?? 1_800_000_000;
  const nonce = overrides.nonce ?? "AAECAwQFBgcICQoLDA0ODw";
  const idempotencyKey = overrides.idempotencyKey ?? "idem-create-1";
  const keyId = overrides.keyId ?? credentials.keyId;
  const bodySha256 = overrides.bodySha256 ?? sha256(bodyText);
  const signature = signBailuRequest(
    {
      method,
      pathname,
      timestamp,
      nonce,
      idempotencyKey,
      bodySha256,
    },
    { keyId, secret: overrides.secret ?? credentials.secret },
  );
  return new Request(`http://127.0.0.1${pathname}`, {
    method,
    headers: {
      "content-type": "application/json",
      [BAILU_AUTH_HEADERS.keyId]: keyId,
      [BAILU_AUTH_HEADERS.timestamp]: String(timestamp),
      [BAILU_AUTH_HEADERS.nonce]: nonce,
      [BAILU_AUTH_HEADERS.idempotencyKey]: idempotencyKey,
      [BAILU_AUTH_HEADERS.bodySha256]: bodySha256,
      [BAILU_AUTH_HEADERS.signature]: signature,
    },
    body: bodyText,
  });
}

describe("bailu.studio/1.0 mirror parsers", () => {
  it("accepts the exact create shape and rejects unknown business scope", () => {
    const expected: CreateProjectRequest = {
      contract_version: "bailu.studio/1.0",
      studio_project_binding_id: "binding-1",
      title: "首饰商品短片",
    };
    expect(parseCreateProjectRequest(expected)).toEqual(expected);
    expect(() => parseCreateProjectRequest({ ...expected, workspace_id: "must-not-cross" })).toThrow(
      "studio_request_invalid",
    );
  });

  it("accepts compose-only runs with a strict existing-option allowlist", () => {
    const expected: RunRequest = {
      contract_version: "bailu.studio/1.0",
      studio_run_id: "studio-run-1",
      operation: "compose",
      input_sha256: "a".repeat(64),
      options: {
        resolution: "1080p",
        aspect_ratio: "9:16",
        render_preset: "standard",
        caption_preset: "bold",
        aigc_badge: true,
        free_tts: false,
        free_bgm: true,
        bgm_duck: true,
        voice_ground: true,
        product_card: true,
        cta_text: "立即了解",
        label: "主版本",
      },
    };
    expect(parseRunRequest(expected)).toEqual(expected);
    expect(() => parseRunRequest({ ...expected, operation: "publish" })).toThrow("studio_request_invalid");
    expect(() => parseRunRequest({ ...expected, options: { outputPath: "C:\\secret\\final.mp4" } })).toThrow(
      "studio_request_invalid",
    );
    expect(() => parseRunRequest({ ...expected, callback_url: "https://attacker.invalid" })).toThrow(
      "studio_request_invalid",
    );
  });
});

describe("signed internal service requests", () => {
  it("uses the locked seven-line canonical payload", () => {
    expect(
      canonicalSignaturePayload({
        method: "post",
        pathname: "/api/bailu/v1/projects",
        timestamp: 1_800_000_000,
        nonce: "AAECAwQFBgcICQoLDA0ODw",
        idempotencyKey: "idem-create-1",
        bodySha256: "f".repeat(64),
      }),
    ).toBe(
      [
        "bailu.studio/1.0",
        "POST",
        "/api/bailu/v1/projects",
        "1800000000",
        "AAECAwQFBgcICQoLDA0ODw",
        "idem-create-1",
        "f".repeat(64),
      ].join("\n"),
    );
  });

  it("verifies the raw body hash before returning parsed request material", async () => {
    const request = await signedRequest({ contract_version: "bailu.studio/1.0" });
    const verified = await verifySignedRequest(request, credentials, { nowSeconds: 1_800_000_050 });
    expect(verified.idempotencyKey).toBe("idem-create-1");
    expect(verified.rawBody).toBe('{"contract_version":"bailu.studio/1.0"}');
    expect(verified.requestSha256).toBe(sha256(verified.rawBody));
  });

  it.each([
    ["missing headers", async () => new Request("http://127.0.0.1/api/bailu/v1/projects", { method: "POST", body: "{}" }), "studio_auth_missing"],
    ["wrong key", async () => signedRequest({}, { keyId: "wrong-key" }), "studio_auth_invalid"],
    ["wrong secret", async () => signedRequest({}, { secret: "wrong-secret" }), "studio_auth_invalid"],
    ["expired timestamp", async () => signedRequest({}, { timestamp: 1_799_999_699 }), "studio_auth_expired"],
    ["future timestamp", async () => signedRequest({}, { timestamp: 1_800_000_301 }), "studio_auth_expired"],
    ["short nonce", async () => signedRequest({}, { nonce: "dG9vLXNob3J0" }), "studio_auth_nonce_invalid"],
    ["body drift", async () => signedRequest({}, { bodySha256: "0".repeat(64) }), "studio_auth_body_mismatch"],
  ])("rejects %s", async (_label, makeRequest, code) => {
    const request = await makeRequest();
    await expect(verifySignedRequest(request, credentials, { nowSeconds: 1_800_000_000 })).rejects.toMatchObject({ code });
  });
});
