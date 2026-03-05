import { appConfig } from "./app-config";
import type { MemorySourceId } from "./config-contract";
import type { MemoryCommitContext, MemoryLoadContext, MemorySource } from "./memory-contract";
import {
  buildMemoryContextPrompt,
  normalizeMemoryEntries,
  runMemoryCommitPipeline,
  runMemoryPipeline,
  selectMemoryEntries,
  type MemoryNormalizeStrategy,
  type MemorySelectionStrategy,
} from "./memory-pipeline";
import { distillMemorySource } from "./memory-source-distill";
import { storedMemorySource } from "./memory-source-stored";

export type MemoryRegistry = {
  load(ctx: MemoryLoadContext, budgetTokens: number): Promise<{ prompt: string; tokenEstimate: number }>;
  commit(ctx: MemoryCommitContext): Promise<void>;
};

export const AVAILABLE_MEMORY_SOURCES: Record<MemorySourceId, MemorySource> = {
  stored: storedMemorySource,
  distill: distillMemorySource,
};

export const DEFAULT_MEMORY_SOURCE_IDS: readonly MemorySourceId[] = ["stored", "distill"];

export function resolveMemorySources(ids: readonly MemorySourceId[]): readonly MemorySource[] {
  const resolved = ids
    .map((id) => AVAILABLE_MEMORY_SOURCES[id])
    .filter((source, index, all) => all.indexOf(source) === index);
  return resolved.length > 0 ? resolved : DEFAULT_MEMORY_SOURCE_IDS.map((id) => AVAILABLE_MEMORY_SOURCES[id]);
}

export const DEFAULT_MEMORY_SOURCES: readonly MemorySource[] = resolveMemorySources(appConfig.memory.sources);

export function createMemoryRegistry(
  sources: readonly MemorySource[] = DEFAULT_MEMORY_SOURCES,
  normalizeEntries: MemoryNormalizeStrategy = normalizeMemoryEntries,
  selectEntries: MemorySelectionStrategy = selectMemoryEntries,
): MemoryRegistry {
  return {
    async load(ctx, budgetTokens) {
      const result = await runMemoryPipeline(sources, ctx, budgetTokens, normalizeEntries, selectEntries);
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
