import type { ComposeOptions } from "./contract";

export interface CompositionSnapshot {
  status: "pending" | "composing" | "done" | "failed";
  outputPath: string | null;
}

export interface CompositionLifecycleHooks {
  onCreated(compositionId: string): Promise<void>;
  onTerminal(compositionId: string, status: "done" | "failed", outputPath?: string): Promise<void>;
}

export interface ComposeAdapter {
  start(
    externalProjectId: string,
    options: ComposeOptions,
    hooks: CompositionLifecycleHooks,
  ): Promise<{ accepted: boolean; status: number }>;
  get(compositionId: string): Promise<CompositionSnapshot | null>;
}
