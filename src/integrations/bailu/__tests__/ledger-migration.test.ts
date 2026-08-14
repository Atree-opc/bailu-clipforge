import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { BailuServiceLedger } from "../ledger";

const tempRoots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "bailu-clipforge-ledger-"));
  tempRoots.push(root);
  return root;
}

function migrationDir(): string {
  return resolve(process.cwd(), "drizzle");
}

function old0011MigrationDir(): string {
  const root = tempRoot();
  const target = join(root, "drizzle-0011");
  cpSync(migrationDir(), target, { recursive: true });
  rmSync(join(target, "0012_add_bailu_service_ledger.sql"));
  rmSync(join(target, "meta", "0012_snapshot.json"));
  const journalPath = join(target, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: Array<{ idx: number }> };
  journal.entries = journal.entries.filter((entry) => entry.idx <= 11);
  writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
  return target;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("0012 Bailu service migration", () => {
  it("upgrades a real 0011 database and is restart-idempotent", () => {
    const sqlite = new Database(":memory:");
    const db = drizzle(sqlite);
    migrate(db, { migrationsFolder: old0011MigrationDir() });
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ad_template_recipes'").get()).toBeTruthy();
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='bailu_service_requests'").get()).toBeUndefined();

    migrate(db, { migrationsFolder: migrationDir() });
    migrate(db, { migrationsFolder: migrationDir() });
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='bailu_service_requests'").get()).toBeTruthy();
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='bailu_service_nonces'").get()).toBeTruthy();
    sqlite.close();
  });

  it("creates and reopens an empty database without destructive SQL", () => {
    const file = join(tempRoot(), "sqlite.db");
    for (let pass = 0; pass < 2; pass += 1) {
      const sqlite = new Database(file);
      migrate(drizzle(sqlite), { migrationsFolder: migrationDir() });
      expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
      sqlite.close();
    }
    const sql = readFileSync(join(migrationDir(), "0012_add_bailu_service_ledger.sql"), "utf8");
    expect(sql).not.toMatch(/\b(?:DROP|DELETE|TRUNCATE|ALTER\s+TABLE)\b/iu);
  });
});

describe("Bailu service ledger", () => {
  function makeLedger(): { sqlite: Database.Database; ledger: BailuServiceLedger } {
    const sqlite = new Database(":memory:");
    migrate(drizzle(sqlite), { migrationsFolder: migrationDir() });
    return { sqlite, ledger: new BailuServiceLedger(sqlite) };
  }

  it("persists nonce replay protection only when explicitly claimed", () => {
    const { sqlite, ledger } = makeLedger();
    ledger.claimVerifiedNonce({ nonce: "AAECAwQFBgcICQoLDA0ODw", keyId: "main-local", requestTimestamp: 1_800_000_000 });
    expect(() =>
      ledger.claimVerifiedNonce({ nonce: "AAECAwQFBgcICQoLDA0ODw", keyId: "main-local", requestTimestamp: 1_800_000_000 }),
    ).toThrowError(expect.objectContaining({ code: "studio_auth_replayed" }));
    sqlite.close();
  });

  it("creates a real project and replays the same create without a duplicate", () => {
    const { sqlite, ledger } = makeLedger();
    const first = ledger.createProjectIdempotent({
      idempotencyKey: "create-1",
      requestSha256: "a".repeat(64),
      title: "商品短片",
    });
    const replay = ledger.createProjectIdempotent({
      idempotencyKey: "create-1",
      requestSha256: "a".repeat(64),
      title: "商品短片",
    });
    expect(replay).toEqual({ ...first, replayed: true });
    expect(sqlite.prepare("SELECT count(*) AS count FROM projects").get()).toMatchObject({ count: 1 });
    expect(() =>
      ledger.createProjectIdempotent({ idempotencyKey: "create-1", requestSha256: "b".repeat(64), title: "changed" }),
    ).toThrowError(expect.objectContaining({ code: "studio_idempotency_conflict" }));
    sqlite.close();
  });

  it("binds a run once and recovers its terminal payload after repository restart", () => {
    const { sqlite, ledger } = makeLedger();
    const project = ledger.createProjectIdempotent({
      idempotencyKey: "create-1",
      requestSha256: "a".repeat(64),
      title: "商品短片",
    });
    const run = ledger.beginRunIdempotent({
      idempotencyKey: "run-1",
      requestSha256: "b".repeat(64),
      studioRunId: "studio-run-1",
      externalProjectId: project.externalProjectId,
      externalTaskId: "external-task-1",
    });
    expect(run.replayed).toBe(false);
    ledger.bindComposition("external-task-1", "composition-1");
    ledger.markTerminal("external-task-1", {
      contract_version: "bailu.studio/1.0",
      studio_run_id: "studio-run-1",
      external_task_id: "external-task-1",
      state: "succeeded",
      outputs: [
        {
          output_id: "composition-1",
          role: "final_video",
          relative_path: "project/final.mp4",
          content_sha256: "c".repeat(64),
          size_bytes: 3,
          mime_type: "video/mp4",
        },
      ],
      error_code: null,
      error_summary: null,
    });

    const restarted = new BailuServiceLedger(sqlite);
    expect(restarted.getRunByExternalTaskId("external-task-1")).toMatchObject({
      studioRunId: "studio-run-1",
      compositionId: "composition-1",
      state: "succeeded",
      terminalPayloadSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      terminalPayload: expect.objectContaining({ state: "succeeded" }),
    });
    expect(() => restarted.bindComposition("external-task-1", "composition-2")).toThrowError(
      expect.objectContaining({ code: "studio_binding_conflict" }),
    );
    sqlite.close();
  });

  it("does not contain main-platform business authorities", () => {
    const { sqlite } = makeLedger();
    const columns = sqlite.prepare("PRAGMA table_info('bailu_service_requests')").all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).not.toEqual(
      expect.arrayContaining(["organization_id", "workspace_id", "campaign_id", "product_id", "workflow_run_id", "artifact_id"]),
    );
    sqlite.close();
  });
});
