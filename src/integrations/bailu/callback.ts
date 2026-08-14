import { createHash, randomBytes } from "crypto";
import { BAILU_AUTH_HEADERS, signBailuRequest, type BailuServiceCredentials } from "./auth";
import type { RunStatusResponse } from "./contract";
import type { BailuRunLedgerRecord, BailuServiceLedger } from "./ledger";

interface CallbackOptions {
  credentials: BailuServiceCredentials;
  callbackUrl?: string;
  fetchImpl?: typeof fetch;
  nowSeconds?: () => number;
  timeoutMs?: number;
}

export function parseFixedCallbackUrl(value: string | undefined): URL | null {
  if (!value) return null;
  // WHATWG URL normalizes leading/trailing spaces and represents a trailing bare
  // ?/# as an empty search/hash. Reject the raw configuration before parsing so
  // those variations cannot alias the reviewed callback identity.
  if (value.trim() !== value || value.includes("?") || value.includes("#")) return null;
  try {
    const url = new URL(value);
    if (!(["http:", "https:"] as const).includes(url.protocol as "http:" | "https:")) return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return url;
  } catch {
    return null;
  }
}

export class BailuCallbackDelivery {
  private readonly url: URL | null;
  private readonly fetchImpl: typeof fetch;
  private readonly nowSeconds: () => number;
  private readonly timeoutMs: number;

  constructor(
    private readonly ledger: BailuServiceLedger,
    private readonly options: CallbackOptions,
  ) {
    this.url = parseFixedCallbackUrl(options.callbackUrl);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.nowSeconds = options.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async deliver(record: BailuRunLedgerRecord, payload: RunStatusResponse): Promise<void> {
    if (record.callbackStatus === "delivered") return;
    const idempotencyKey = `callback-${record.externalTaskId}`;
    const nonce = randomBytes(16).toString("base64url");
    if (!this.url) {
      this.ledger.recordCallbackAttempt({
        externalTaskId: record.externalTaskId,
        idempotencyKey,
        nonce,
        status: "not_configured",
        errorCode: "callback_not_configured",
      });
      return;
    }

    const rawBody = JSON.stringify(payload);
    const bodySha256 = createHash("sha256").update(rawBody).digest("hex");
    const timestamp = this.nowSeconds();
    const signature = signBailuRequest(
      {
        method: "POST",
        pathname: this.url.pathname,
        timestamp,
        nonce,
        idempotencyKey,
        bodySha256,
      },
      this.options.credentials,
    );
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [BAILU_AUTH_HEADERS.keyId]: this.options.credentials.keyId,
          [BAILU_AUTH_HEADERS.timestamp]: String(timestamp),
          [BAILU_AUTH_HEADERS.nonce]: nonce,
          [BAILU_AUTH_HEADERS.idempotencyKey]: idempotencyKey,
          [BAILU_AUTH_HEADERS.bodySha256]: bodySha256,
          [BAILU_AUTH_HEADERS.signature]: signature,
        },
        body: rawBody,
        signal: controller.signal,
      });
      this.ledger.recordCallbackAttempt({
        externalTaskId: record.externalTaskId,
        idempotencyKey,
        nonce,
        status: response.ok ? "delivered" : "failed",
        errorCode: response.ok ? null : "callback_delivery_rejected",
      });
    } catch {
      this.ledger.recordCallbackAttempt({
        externalTaskId: record.externalTaskId,
        idempotencyKey,
        nonce,
        status: "failed",
        errorCode: "callback_delivery_failed",
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
