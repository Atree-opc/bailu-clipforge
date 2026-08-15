import { BailuAuthError, verifySignedRequest } from "./auth";
import {
  STUDIO_OUTPUT_CONTENT_HEADERS,
  STUDIO_CONTRACT_VERSION,
  studioOutputContentPath,
  StudioContractError,
  parseCreateProjectRequest,
  parseRunRequest,
  type ServiceErrorResponse,
} from "./contract";
import { BailuLedgerError } from "./ledger";
import { BailuOutputError } from "./manifest";
import { BailuRuntimeConfigError, type BailuServiceRuntime } from "./runtime";
import { StudioServiceError } from "./service";

const EXTERNAL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

function response(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function summaryFor(code: string): string {
  const summaries: Record<string, string> = {
    studio_auth_missing: "Service authentication is required",
    studio_auth_invalid: "Service authentication failed",
    studio_auth_expired: "Service authentication expired",
    studio_auth_nonce_invalid: "Service nonce is invalid",
    studio_auth_body_mismatch: "Request body integrity check failed",
    studio_auth_idempotency_invalid: "Idempotency key is invalid",
    studio_auth_replayed: "Service nonce was already used",
    studio_request_invalid: "Studio request is invalid",
    studio_idempotency_conflict: "Idempotency key conflicts with an earlier request",
    studio_binding_conflict: "Studio execution binding conflicts with an earlier request",
    studio_project_not_found: "Studio project not found",
    studio_run_not_found: "Studio run not found",
    studio_output_not_found: "Studio output not found",
    studio_output_not_ready: "Studio output is not ready",
    studio_output_invalid: "Studio output is invalid",
    studio_range_not_supported: "Studio output ranges are not supported",
    studio_service_not_configured: "Studio service identity is not configured",
  };
  return summaries[code] ?? "Studio service request failed";
}

export function studioRouteErrorResponse(error: unknown): Response {
  let code = "studio_internal_error";
  let status = 500;
  let summary = "Studio service request failed";
  if (error instanceof BailuAuthError || error instanceof BailuLedgerError) {
    ({ code, status } = error);
    summary = summaryFor(code);
  } else if (error instanceof StudioContractError) {
    code = error.code;
    status = 400;
    summary = summaryFor(code);
  } else if (error instanceof StudioServiceError) {
    ({ code, status, summary } = error);
  } else if (error instanceof BailuOutputError) {
    code = error.code;
    status = 422;
    summary = summaryFor(code);
  } else if (error instanceof BailuRuntimeConfigError) {
    code = error.code;
    status = 503;
    summary = summaryFor(code);
  }
  const body: ServiceErrorResponse = {
    contract_version: STUDIO_CONTRACT_VERSION,
    error_code: code,
    error_summary: summary,
  };
  return response(body, status);
}

async function verified(request: Request, runtime: BailuServiceRuntime) {
  const signed = await verifySignedRequest(request, runtime.credentials);
  runtime.service.claimVerifiedNonce(signed);
  return signed;
}

function json(rawBody: string): unknown {
  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    throw new StudioContractError();
  }
}

export async function handleCreateProject(request: Request, runtime: BailuServiceRuntime): Promise<Response> {
  try {
    const signed = await verified(request, runtime);
    const created = runtime.service.createProject(signed, parseCreateProjectRequest(json(signed.rawBody)));
    return response(created, 201);
  } catch (error) {
    return studioRouteErrorResponse(error);
  }
}

export async function handleStartRun(
  request: Request,
  externalProjectId: string,
  runtime: BailuServiceRuntime,
): Promise<Response> {
  try {
    if (!EXTERNAL_ID.test(externalProjectId)) throw new StudioContractError();
    const signed = await verified(request, runtime);
    const accepted = await runtime.service.startRun(externalProjectId, signed, parseRunRequest(json(signed.rawBody)));
    return response(accepted, 202);
  } catch (error) {
    return studioRouteErrorResponse(error);
  }
}

export async function handleGetRun(
  request: Request,
  externalTaskId: string,
  runtime: BailuServiceRuntime,
): Promise<Response> {
  try {
    if (!EXTERNAL_ID.test(externalTaskId)) throw new StudioContractError();
    await verified(request, runtime);
    return response(await runtime.service.getRun(externalTaskId));
  } catch (error) {
    return studioRouteErrorResponse(error);
  }
}

export async function handleGetRunOutputContent(
  request: Request,
  externalTaskId: string,
  outputId: string,
  runtime: BailuServiceRuntime,
): Promise<Response> {
  try {
    const expectedPath = studioOutputContentPath(externalTaskId, outputId);
    const rawUrl = request.url;
    const schemeEnd = rawUrl.indexOf("://");
    const rawPathStart = schemeEnd >= 0 ? rawUrl.indexOf("/", schemeEnd + 3) : -1;
    const rawPath = rawPathStart >= 0 ? rawUrl.slice(rawPathStart) : "";
    if (
      request.method !== "GET" ||
      rawUrl.includes("?") ||
      rawUrl.includes("#") ||
      rawPath !== expectedPath
    ) {
      throw new StudioContractError();
    }
    if (request.headers.has("range")) {
      throw new StudioServiceError("studio_range_not_supported", 400, summaryFor("studio_range_not_supported"));
    }
    const contentLength = request.headers.get("content-length");
    if (request.headers.has("transfer-encoding") || (contentLength !== null && contentLength !== "0")) {
      throw new StudioContractError();
    }
    const signed = await verifySignedRequest(request, runtime.credentials);
    if (signed.rawBody !== "") throw new StudioContractError();
    runtime.service.claimVerifiedNonce(signed);
    const opened = await runtime.service.getRunOutputContent(externalTaskId, outputId);
    try {
      return new Response(opened.createReadableStream(), {
        status: 200,
        headers: {
          [STUDIO_OUTPUT_CONTENT_HEADERS.contentType]: opened.manifest.mime_type,
          [STUDIO_OUTPUT_CONTENT_HEADERS.contentLength]: String(opened.manifest.size_bytes),
          [STUDIO_OUTPUT_CONTENT_HEADERS.contentSha256]: opened.manifest.content_sha256,
          [STUDIO_OUTPUT_CONTENT_HEADERS.cacheControl]: "no-store",
          [STUDIO_OUTPUT_CONTENT_HEADERS.contentTypeOptions]: "nosniff",
        },
      });
    } catch (error) {
      await opened.close();
      throw error;
    }
  } catch (error) {
    return studioRouteErrorResponse(error);
  }
}
