import type { MemoryCommitContext, MemoryCommitMetrics, MemoryLoadContext } from "./memory-contract";
import { runMemoryCommitPipeline } from "./memory-pipeline";
import {
  distillMemorySource,
  distillProjectMemorySource,
  distillUserMemorySource,
} from "./memory-source-distill";

export type MemoryRegistry = {
  load(
    ctx: MemoryLoadContext,
    budgetTokens: number,
  ): Promise<{
    prompt: string;
    tokenEstimate: number;
    entryCount: number;
    continuationSelected: boolean;
    continuation: {
      currentTask?: string;
      nextStep?: string;
    };
  }>;
  commit(ctx: MemoryCommitContext): Promise<MemoryCommitMetrics>;
};

const COMMIT_SOURCES = [distillMemorySource, distillProjectMemorySource, distillUserMemorySource];

export function createMemoryRegistry(): MemoryRegistry {
  return {
    async load() {
      return { prompt: "", tokenEstimate: 0, entryCount: 0, continuationSelected: false, continuation: {} };
    },
    async commit(ctx) {
      return await runMemoryCommitPipeline(COMMIT_SOURCES, ctx);
    },
  };
}

let defaultMemoryRegistry: MemoryRegistry | null = null;

function getDefaultMemoryRegistry(): MemoryRegistry {
  if (!defaultMemoryRegistry) {
    defaultMemoryRegistry = createMemoryRegistry();
  }
  return defaultMemoryRegistry;
}

export const loadMemoryContext: MemoryRegistry["load"] = (ctx, budgetTokens) =>
  getDefaultMemoryRegistry().load(ctx, budgetTokens);
export const commitMemorySources: MemoryRegistry["commit"] = (ctx) => getDefaultMemoryRegistry().commit(ctx);
