import { randomUUID } from "crypto";
import type { VerifiedSignedRequest } from "./auth";
import type { BailuCallbackDelivery } from "./callback";
import {
  STUDIO_CONTRACT_VERSION,
  type CreateProjectRequest,
  type CreateProjectResponse,
  type RunAcceptedResponse,
  type RunRequest,
  type RunStatusResponse,
} from "./contract";
import type { ComposeAdapter } from "./compose-adapter";
import type { BailuServiceLedger } from "./ledger";
import { buildOutputManifest, openVerifiedOutputContent, type VerifiedOutputContent } from "./manifest";

export class StudioServiceError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly summary: string,
  ) {
    super(code);
    this.name = "StudioServiceError";
  }
}

interface ServiceDependencies {
  ledger: BailuServiceLedger;
  compose: ComposeAdapter;
  callback: BailuCallbackDelivery;
  outputRoot: string;
}

type RequestIdentity = Pick<VerifiedSignedRequest, "idempotencyKey" | "requestSha256">;

export class BailuStudioService {
  constructor(private readonly dependencies: ServiceDependencies) {}

  claimVerifiedNonce(request: VerifiedSignedRequest): void {
    this.dependencies.ledger.claimVerifiedNonce({
      nonce: request.nonce,
      keyId: request.keyId,
      requestTimestamp: request.timestamp,
    });
  }

  createProject(identity: RequestIdentity, request: CreateProjectRequest): CreateProjectResponse {
    const created = this.dependencies.ledger.createProjectIdempotent({
      idempotencyKey: identity.idempotencyKey,
      requestSha256: identity.requestSha256,
      title: request.title,
    });
    return {
      contract_version: STUDIO_CONTRACT_VERSION,
      external_project_id: created.externalProjectId,
      external_revision: null,
      state: "active",
    };
  }

  async startRun(
    externalProjectId: string,
    identity: RequestIdentity,
    request: RunRequest,
  ): Promise<RunAcceptedResponse> {
    const externalTaskId = randomUUID();
    const run = this.dependencies.ledger.beginRunIdempotent({
      idempotencyKey: identity.idempotencyKey,
      requestSha256: identity.requestSha256,
      studioRunId: request.studio_run_id,
      externalProjectId,
      externalTaskId,
    });
    if (run.replayed) {
      if (run.terminalPayload?.state === "failed") {
        throw new StudioServiceError(
          run.terminalPayload.error_code ?? "studio_compose_failed",
          422,
          run.terminalPayload.error_summary ?? "Composition failed",
        );
      }
      return {
        contract_version: STUDIO_CONTRACT_VERSION,
        studio_run_id: run.studioRunId,
        external_task_id: run.externalTaskId,
        state: "running",
      };
    }

    let result: { accepted: boolean; status: number };
    try {
      result = await this.dependencies.compose.start(externalProjectId, request.options, {
        onCreated: async (compositionId) => {
          this.dependencies.ledger.bindComposition(run.externalTaskId, compositionId);
        },
        onTerminal: async (compositionId, status, outputPath) => {
          await this.finalizeRun(run.externalTaskId, compositionId, status, outputPath);
        },
      });
    } catch {
      await this.failRun(run.externalTaskId, "studio_compose_unavailable", "Composition service unavailable");
      throw new StudioServiceError("studio_compose_unavailable", 503, "Composition service unavailable");
    }
    if (!result.accepted) {
      await this.failRun(run.externalTaskId, "studio_compose_rejected", "Composition request rejected");
      throw new StudioServiceError("studio_compose_rejected", result.status === 404 ? 404 : 422, "Composition request rejected");
    }
    return {
      contract_version: STUDIO_CONTRACT_VERSION,
      studio_run_id: request.studio_run_id,
      external_task_id: run.externalTaskId,
      state: "running",
    };
  }

  async getRun(externalTaskId: string): Promise<RunStatusResponse> {
    const run = this.dependencies.ledger.getRunByExternalTaskId(externalTaskId);
    if (!run) throw new StudioServiceError("studio_run_not_found", 404, "Studio run not found");
    if (run.terminalPayload) return run.terminalPayload;
    if (!run.compositionId) return this.nonTerminalStatus(run.studioRunId, run.externalTaskId, "remote_state_unknown");

    const snapshot = await this.dependencies.compose.get(run.compositionId);
    if (!snapshot) return this.nonTerminalStatus(run.studioRunId, run.externalTaskId, "remote_state_unknown");
    if (snapshot.status === "done" || snapshot.status === "failed") {
      return this.finalizeRun(run.externalTaskId, run.compositionId, snapshot.status, snapshot.outputPath ?? undefined);
    }
    return this.nonTerminalStatus(run.studioRunId, run.externalTaskId, "running");
  }

  async getRunOutputContent(externalTaskId: string, outputId: string): Promise<VerifiedOutputContent> {
    const run = this.dependencies.ledger.getRunByExternalTaskId(externalTaskId);
    if (!run) throw new StudioServiceError("studio_run_not_found", 404, "Studio run not found");
    if (run.terminalPayload?.state !== "succeeded") {
      throw new StudioServiceError("studio_output_not_ready", 409, "Studio output is not ready");
    }
    const output = run.terminalPayload.outputs.find((candidate) => candidate.output_id === outputId);
    if (!output) throw new StudioServiceError("studio_output_not_found", 404, "Studio output not found");
    return openVerifiedOutputContent(this.dependencies.outputRoot, output);
  }

  private nonTerminalStatus(
    studioRunId: string,
    externalTaskId: string,
    state: "running" | "remote_state_unknown",
  ): RunStatusResponse {
    return {
      contract_version: STUDIO_CONTRACT_VERSION,
      studio_run_id: studioRunId,
      external_task_id: externalTaskId,
      state,
      outputs: [],
      error_code: null,
      error_summary: null,
    };
  }

  private async failRun(externalTaskId: string, errorCode: string, errorSummary: string): Promise<RunStatusResponse> {
    const payload = this.dependencies.ledger.markRunFailed(externalTaskId, errorCode, errorSummary);
    const persisted = this.dependencies.ledger.getRunByExternalTaskId(externalTaskId);
    if (persisted) await this.dependencies.callback.deliver(persisted, payload);
    return payload;
  }

  private async finalizeRun(
    externalTaskId: string,
    compositionId: string,
    status: "done" | "failed",
    outputPath?: string,
  ): Promise<RunStatusResponse> {
    const current = this.dependencies.ledger.getRunByExternalTaskId(externalTaskId);
    if (!current) throw new StudioServiceError("studio_run_not_found", 404, "Studio run not found");
    if (current.terminalPayload) return current.terminalPayload;

    let payload: RunStatusResponse;
    if (status === "done" && outputPath) {
      try {
        payload = {
          contract_version: STUDIO_CONTRACT_VERSION,
          studio_run_id: current.studioRunId,
          external_task_id: current.externalTaskId,
          state: "succeeded",
          outputs: await buildOutputManifest(this.dependencies.outputRoot, compositionId, outputPath),
          error_code: null,
          error_summary: null,
        };
      } catch {
        payload = {
          contract_version: STUDIO_CONTRACT_VERSION,
          studio_run_id: current.studioRunId,
          external_task_id: current.externalTaskId,
          state: "failed",
          outputs: [],
          error_code: "studio_output_invalid",
          error_summary: "Composition output is invalid",
        };
      }
    } else {
      payload = {
        contract_version: STUDIO_CONTRACT_VERSION,
        studio_run_id: current.studioRunId,
        external_task_id: current.externalTaskId,
        state: "failed",
        outputs: [],
        error_code: "studio_compose_failed",
        error_summary: "Composition failed",
      };
    }
    this.dependencies.ledger.markTerminal(externalTaskId, payload);
    const persisted = this.dependencies.ledger.getRunByExternalTaskId(externalTaskId);
    if (persisted) await this.dependencies.callback.deliver(persisted, payload);
    return payload;
  }
}
