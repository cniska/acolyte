import { appConfig } from "./app-config";
import type { MemorySourceId } from "./config-contract";
import type { MemoryCommitContext, MemoryCommitMetrics, MemoryLoadContext, MemorySource } from "./memory-contract";
import {
  buildMemoryContextPrompt,
  type MemoryNormalizeStrategy,
  type MemorySelectionStrategy,
  normalizeMemoryEntries,
  runMemoryCommitPipeline,
  runMemoryPipeline,
  selectMemoryEntries,
} from "./memory-pipeline";
import {
  distillMemorySource,
  distillProjectMemorySource,
  distillUserMemorySource,
  extractLastLineValue,
} from "./memory-source-distill";
import { storedMemorySource } from "./memory-source-stored";

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

export const AVAILABLE_MEMORY_SOURCES: Record<MemorySourceId, MemorySource> = {
  stored: storedMemorySource,
  distill_user: distillUserMemorySource,
  distill_project: distillProjectMemorySource,
  distill_session: distillMemorySource,
};

export const DEFAULT_MEMORY_SOURCE_IDS: readonly MemorySourceId[] = [
  "stored",
  "distill_project",
  "distill_user",
  "distill_session",
];

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
  const extractContinuation = (
    entries: readonly {
      content: string;
      isContinuation?: boolean;
    }[],
  ): { currentTask?: string; nextStep?: string } => {
    const continuationText = entries
      .filter((entry) => entry.isContinuation === true)
      .map((entry) => entry.content)
      .join("\n");
    return {
      currentTask: extractLastLineValue(continuationText, /^(?:[-*]\s*)?Current task:\s*(.+)$/gim),
      nextStep: extractLastLineValue(continuationText, /^(?:[-*]\s*)?Next step:\s*(.+)$/gim),
    };
  };

  return {
    async load(ctx, budgetTokens) {
      const result = await runMemoryPipeline(sources, ctx, budgetTokens, normalizeEntries, selectEntries);
      const continuation = extractContinuation(result.entries);
      return {
        prompt: buildMemoryContextPrompt(result.entries),
        tokenEstimate: result.tokenEstimate,
        entryCount: result.entries.length,
        continuationSelected: result.entries.some((entry) => entry.isContinuation === true),
        continuation,
      };
    },
    async commit(ctx) {
      return await runMemoryCommitPipeline(sources, ctx);
    },
  };
}

const defaultMemoryRegistry = createMemoryRegistry();

export const loadMemoryContext = defaultMemoryRegistry.load;
export const commitMemorySources = defaultMemoryRegistry.commit;
