import { createHash, randomUUID } from "crypto";
import type Database from "better-sqlite3";
import type { RunStatusResponse } from "./contract";

type RequestKind = "create_project" | "compose";
type LedgerState = "submitted" | "running" | "succeeded" | "failed" | "remote_state_unknown";
type CallbackStatus = "pending" | "delivered" | "failed" | "not_configured";

interface RequestRow {
  idempotency_key: string;
  request_kind: RequestKind;
  request_sha256: string;
  external_project_id: string | null;
  studio_run_id: string | null;
  external_task_id: string | null;
  composition_id: string | null;
  state: LedgerState;
  terminal_payload: string | null;
  terminal_payload_sha256: string | null;
  callback_idempotency_key: string | null;
  callback_nonce: string | null;
  callback_status: CallbackStatus;
  callback_attempts: number;
  callback_last_error_code: string | null;
  callback_delivered_at: number | null;
  created_at: number | null;
  updated_at: number | null;
}

export interface BailuRunLedgerRecord {
  idempotencyKey: string;
  requestSha256: string;
  externalProjectId: string;
  studioRunId: string;
  externalTaskId: string;
  compositionId: string | null;
  state: LedgerState;
  terminalPayload: RunStatusResponse | null;
  terminalPayloadSha256: string | null;
  callbackIdempotencyKey: string | null;
  callbackNonce: string | null;
  callbackStatus: CallbackStatus;
  callbackAttempts: number;
  callbackLastErrorCode: string | null;
}

export class BailuLedgerError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
    this.name = "BailuLedgerError";
  }
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function requestRow(statement: Database.Statement, value: string): RequestRow | undefined {
  return statement.get(value) as RequestRow | undefined;
}

function toRunRecord(row: RequestRow | undefined): BailuRunLedgerRecord | null {
  if (!row || row.request_kind !== "compose" || !row.external_project_id || !row.studio_run_id || !row.external_task_id) {
    return null;
  }
  return {
    idempotencyKey: row.idempotency_key,
    requestSha256: row.request_sha256,
    externalProjectId: row.external_project_id,
    studioRunId: row.studio_run_id,
    externalTaskId: row.external_task_id,
    compositionId: row.composition_id,
    state: row.state,
    terminalPayload: row.terminal_payload ? (JSON.parse(row.terminal_payload) as RunStatusResponse) : null,
    terminalPayloadSha256: row.terminal_payload_sha256,
    callbackIdempotencyKey: row.callback_idempotency_key,
    callbackNonce: row.callback_nonce,
    callbackStatus: row.callback_status,
    callbackAttempts: row.callback_attempts,
    callbackLastErrorCode: row.callback_last_error_code,
  };
}

function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Error && /(?:UNIQUE|PRIMARY KEY) constraint failed/iu.test(error.message);
}

export class BailuServiceLedger {
  constructor(private readonly sqlite: Database.Database) {}

  claimVerifiedNonce(input: { nonce: string; keyId: string; requestTimestamp: number }): void {
    try {
      this.sqlite
        .prepare(
          "INSERT INTO bailu_service_nonces (nonce, key_id, request_timestamp, created_at) VALUES (?, ?, ?, ?)",
        )
        .run(input.nonce, input.keyId, input.requestTimestamp, nowSeconds());
    } catch (error) {
      if (isUniqueConstraint(error)) throw new BailuLedgerError("studio_auth_replayed", 409);
      throw error;
    }
  }

  createProjectIdempotent(input: {
    idempotencyKey: string;
    requestSha256: string;
    title: string;
  }): { externalProjectId: string; replayed: boolean } {
    return this.sqlite.transaction(() => {
      const select = this.sqlite.prepare("SELECT * FROM bailu_service_requests WHERE idempotency_key = ?");
      const existing = requestRow(select, input.idempotencyKey);
      if (existing) {
        if (
          existing.request_kind !== "create_project" ||
          existing.request_sha256 !== input.requestSha256 ||
          !existing.external_project_id
        ) {
          throw new BailuLedgerError("studio_idempotency_conflict", 409);
        }
        return { externalProjectId: existing.external_project_id, replayed: true };
      }

      const externalProjectId = randomUUID();
      const now = nowSeconds();
      this.sqlite
        .prepare("INSERT INTO projects (id, name, status, created_at, updated_at) VALUES (?, ?, 'draft', ?, ?)")
        .run(externalProjectId, input.title, now, now);
      this.sqlite
        .prepare(
          `INSERT INTO bailu_service_requests (
             idempotency_key, request_kind, request_sha256, external_project_id,
             state, callback_status, callback_attempts, created_at, updated_at
           ) VALUES (?, 'create_project', ?, ?, 'succeeded', 'not_configured', 0, ?, ?)`,
        )
        .run(input.idempotencyKey, input.requestSha256, externalProjectId, now, now);
      return { externalProjectId, replayed: false };
    })();
  }

  beginRunIdempotent(input: {
    idempotencyKey: string;
    requestSha256: string;
    studioRunId: string;
    externalProjectId: string;
    externalTaskId: string;
  }): BailuRunLedgerRecord & { replayed: boolean } {
    return this.sqlite.transaction(() => {
      const project = this.sqlite.prepare("SELECT id FROM projects WHERE id = ?").get(input.externalProjectId);
      if (!project) throw new BailuLedgerError("studio_project_not_found", 404);

      const byIdempotency = requestRow(
        this.sqlite.prepare("SELECT * FROM bailu_service_requests WHERE idempotency_key = ?"),
        input.idempotencyKey,
      );
      if (byIdempotency) {
        const replay = toRunRecord(byIdempotency);
        if (
          !replay ||
          replay.requestSha256 !== input.requestSha256 ||
          replay.studioRunId !== input.studioRunId ||
          replay.externalProjectId !== input.externalProjectId
        ) {
          throw new BailuLedgerError("studio_idempotency_conflict", 409);
        }
        return { ...replay, replayed: true };
      }

      const existingRun = this.sqlite
        .prepare("SELECT idempotency_key FROM bailu_service_requests WHERE studio_run_id = ?")
        .get(input.studioRunId);
      if (existingRun) throw new BailuLedgerError("studio_idempotency_conflict", 409);

      const now = nowSeconds();
      try {
        this.sqlite
          .prepare(
            `INSERT INTO bailu_service_requests (
               idempotency_key, request_kind, request_sha256, external_project_id,
               studio_run_id, external_task_id, state, callback_status,
               callback_attempts, created_at, updated_at
             ) VALUES (?, 'compose', ?, ?, ?, ?, 'submitted', 'pending', 0, ?, ?)`,
          )
          .run(
            input.idempotencyKey,
            input.requestSha256,
            input.externalProjectId,
            input.studioRunId,
            input.externalTaskId,
            now,
            now,
          );
      } catch (error) {
        if (isUniqueConstraint(error)) throw new BailuLedgerError("studio_idempotency_conflict", 409);
        throw error;
      }
      const created = this.getRunByExternalTaskId(input.externalTaskId);
      if (!created) throw new BailuLedgerError("studio_ledger_unavailable", 500);
      return { ...created, replayed: false };
    })();
  }

  bindComposition(externalTaskId: string, compositionId: string): void {
    this.sqlite.transaction(() => {
      const row = this.getRunByExternalTaskId(externalTaskId);
      if (!row) throw new BailuLedgerError("studio_run_not_found", 404);
      if (row.compositionId && row.compositionId !== compositionId) {
        throw new BailuLedgerError("studio_binding_conflict", 409);
      }
      this.sqlite
        .prepare(
          "UPDATE bailu_service_requests SET composition_id = ?, state = 'running', updated_at = ? WHERE external_task_id = ?",
        )
        .run(compositionId, nowSeconds(), externalTaskId);
    })();
  }

  markTerminal(externalTaskId: string, payload: RunStatusResponse): void {
    const serialized = JSON.stringify(payload);
    const payloadSha256 = createHash("sha256").update(serialized).digest("hex");
    const updated = this.sqlite
      .prepare(
        `UPDATE bailu_service_requests
           SET state = ?, terminal_payload = ?, terminal_payload_sha256 = ?, updated_at = ?
         WHERE external_task_id = ? AND request_kind = 'compose'`,
      )
      .run(payload.state, serialized, payloadSha256, nowSeconds(), externalTaskId);
    if (updated.changes !== 1) throw new BailuLedgerError("studio_run_not_found", 404);
  }

  markRunFailed(externalTaskId: string, errorCode: string, errorSummary: string): RunStatusResponse {
    const row = this.getRunByExternalTaskId(externalTaskId);
    if (!row) throw new BailuLedgerError("studio_run_not_found", 404);
    const payload: RunStatusResponse = {
      contract_version: "bailu.studio/1.0",
      studio_run_id: row.studioRunId,
      external_task_id: row.externalTaskId,
      state: "failed",
      outputs: [],
      error_code: errorCode,
      error_summary: errorSummary,
    };
    this.markTerminal(externalTaskId, payload);
    return payload;
  }

  getRunByExternalTaskId(externalTaskId: string): BailuRunLedgerRecord | null {
    return toRunRecord(
      requestRow(
        this.sqlite.prepare("SELECT * FROM bailu_service_requests WHERE external_task_id = ?"),
        externalTaskId,
      ),
    );
  }

  recordCallbackAttempt(input: {
    externalTaskId: string;
    idempotencyKey: string;
    nonce: string;
    status: CallbackStatus;
    errorCode: string | null;
  }): void {
    this.sqlite
      .prepare(
        `UPDATE bailu_service_requests
           SET callback_idempotency_key = ?, callback_nonce = ?, callback_status = ?,
               callback_attempts = callback_attempts + 1, callback_last_error_code = ?,
               callback_delivered_at = CASE WHEN ? = 'delivered' THEN ? ELSE callback_delivered_at END,
               updated_at = ?
         WHERE external_task_id = ?`,
      )
      .run(
        input.idempotencyKey,
        input.nonce,
        input.status,
        input.errorCode,
        input.status,
        nowSeconds(),
        nowSeconds(),
        input.externalTaskId,
      );
  }
}
