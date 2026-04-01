import type { MemoryCommitContext, MemoryCommitMetrics } from "./memory-contract";
import { runMemoryCommitPipeline } from "./memory-pipeline";
import { distillMemorySource, distillProjectMemorySource, distillUserMemorySource } from "./memory-source-distill";

export type MemoryRegistry = {
  commit(ctx: MemoryCommitContext): Promise<MemoryCommitMetrics>;
};

const COMMIT_SOURCES = [distillMemorySource, distillProjectMemorySource, distillUserMemorySource];

export function createMemoryRegistry(): MemoryRegistry {
  return {
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

export const commitMemorySources: MemoryRegistry["commit"] = (ctx) => getDefaultMemoryRegistry().commit(ctx);
