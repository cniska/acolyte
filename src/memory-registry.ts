import type { MemoryCommitContext, MemoryLoadContext, MemorySource } from "./memory-contract";
import { buildMemoryContextPrompt, runMemoryCommitPipeline, runMemoryPipeline } from "./memory-pipeline";
import { distillMemorySource } from "./memory-source-distill";
import { storedMemorySource } from "./memory-source-stored";

export type MemoryRegistry = {
  load(ctx: MemoryLoadContext, budgetTokens: number): Promise<{ prompt: string; tokenEstimate: number }>;
  commit(ctx: MemoryCommitContext): Promise<void>;
};

export const DEFAULT_MEMORY_SOURCES: readonly MemorySource[] = [storedMemorySource, distillMemorySource];

export function createMemoryRegistry(sources: readonly MemorySource[] = DEFAULT_MEMORY_SOURCES): MemoryRegistry {
  return {
    async load(ctx, budgetTokens) {
      const result = await runMemoryPipeline(sources, ctx, budgetTokens);
      return {
        prompt: buildMemoryContextPrompt(result.entries),
        tokenEstimate: result.tokenEstimate,
      };
    },
    async commit(ctx) {
      await runMemoryCommitPipeline(sources, ctx);
    },
  };
}

const defaultMemoryRegistry = createMemoryRegistry();

export const loadMemoryContext = defaultMemoryRegistry.load;
export const commitMemorySources = defaultMemoryRegistry.commit;
