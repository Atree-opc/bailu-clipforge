import { createHash, createHmac, timingSafeEqual } from "crypto";
import { STUDIO_CONTRACT_VERSION } from "./contract";

export const BAILU_AUTH_HEADERS = {
  keyId: "x-bailu-key-id",
  timestamp: "x-bailu-timestamp",
  nonce: "x-bailu-nonce",
  idempotencyKey: "x-bailu-idempotency-key",
  bodySha256: "x-bailu-body-sha256",
  signature: "x-bailu-signature",
} as const;

const SHA256 = /^[0-9a-f]{64}$/u;
const SIGNATURE = /^[0-9a-f]{64}$/u;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const BASE64URL = /^[A-Za-z0-9_-]+$/u;

export interface BailuServiceCredentials {
  keyId: string;
  secret: string;
}

export interface SignatureMaterial {
  method: string;
  pathname: string;
  timestamp: number;
  nonce: string;
  idempotencyKey: string;
  bodySha256: string;
}

export interface VerifiedSignedRequest {
  rawBody: string;
  requestSha256: string;
  keyId: string;
  timestamp: number;
  nonce: string;
  idempotencyKey: string;
}

export class BailuAuthError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
    this.name = "BailuAuthError";
  }
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  if (a.length !== b.length) {
    const dummy = Buffer.alloc(a.length);
    timingSafeEqual(a, dummy);
    return false;
  }
  return timingSafeEqual(a, b);
}

function decodedNonceBytes(value: string): number {
  if (!BASE64URL.test(value) || value.includes("=")) return 0;
  try {
    const decoded = Buffer.from(value, "base64url");
    return decoded.toString("base64url") === value ? decoded.length : 0;
  } catch {
    return 0;
  }
}

export function canonicalSignaturePayload(material: SignatureMaterial): string {
  return [
    STUDIO_CONTRACT_VERSION,
    material.method.toUpperCase(),
    material.pathname,
    String(material.timestamp),
    material.nonce,
    material.idempotencyKey,
    material.bodySha256,
  ].join("\n");
}

export function signBailuRequest(material: SignatureMaterial, credentials: BailuServiceCredentials): string {
  return createHmac("sha256", credentials.secret).update(canonicalSignaturePayload(material)).digest("hex");
}

export async function verifySignedRequest(
  request: Request,
  credentials: BailuServiceCredentials,
  options: { nowSeconds?: number } = {},
): Promise<VerifiedSignedRequest> {
  const keyId = request.headers.get(BAILU_AUTH_HEADERS.keyId);
  const timestampText = request.headers.get(BAILU_AUTH_HEADERS.timestamp);
  const nonce = request.headers.get(BAILU_AUTH_HEADERS.nonce);
  const idempotencyKey = request.headers.get(BAILU_AUTH_HEADERS.idempotencyKey);
  const claimedBodySha256 = request.headers.get(BAILU_AUTH_HEADERS.bodySha256);
  const signature = request.headers.get(BAILU_AUTH_HEADERS.signature);
  if (!keyId || !timestampText || !nonce || !idempotencyKey || !claimedBodySha256 || !signature) {
    throw new BailuAuthError("studio_auth_missing", 401);
  }

  const rawBody = await request.text();
  const requestSha256 = createHash("sha256").update(rawBody).digest("hex");
  if (!SHA256.test(claimedBodySha256) || !safeEqual(requestSha256, claimedBodySha256)) {
    throw new BailuAuthError("studio_auth_body_mismatch", 401);
  }

  const timestamp = Number(timestampText);
  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(timestamp) || Math.abs(nowSeconds - timestamp) > 300) {
    throw new BailuAuthError("studio_auth_expired", 401);
  }
  if (decodedNonceBytes(nonce) < 16) throw new BailuAuthError("studio_auth_nonce_invalid", 401);
  if (!TOKEN.test(idempotencyKey)) throw new BailuAuthError("studio_auth_idempotency_invalid", 400);

  const expected = signBailuRequest(
    {
      method: request.method,
      pathname: new URL(request.url).pathname,
      timestamp,
      nonce,
      idempotencyKey,
      bodySha256: requestSha256,
    },
    credentials,
  );
  if (!safeEqual(keyId, credentials.keyId) || !SIGNATURE.test(signature) || !safeEqual(signature, expected)) {
    throw new BailuAuthError("studio_auth_invalid", 401);
  }

  return { rawBody, requestSha256, keyId, timestamp, nonce, idempotencyKey };
}
