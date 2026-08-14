import { BailuAuthError, verifySignedRequest } from "./auth";
import {
  STUDIO_CONTRACT_VERSION,
  StudioContractError,
  parseCreateProjectRequest,
  parseRunRequest,
  type ServiceErrorResponse,
} from "./contract";
import { BailuLedgerError } from "./ledger";
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
