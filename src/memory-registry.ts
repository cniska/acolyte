import type { MemoryCommitContext, MemoryLoadContext, MemorySource } from "./memory-contract";
import { buildMemoryContextPrompt, runMemoryCommitPipeline, runMemoryPipeline } from "./memory-pipeline";
import { distillMemorySource } from "./memory-source-distill";
import { storedMemorySource } from "./memory-source-stored";

const MEMORY_SOURCES: readonly MemorySource[] = [storedMemorySource, distillMemorySource];

export async function loadMemoryContext(
  ctx: MemoryLoadContext,
  budgetTokens: number,
): Promise<{ prompt: string; tokenEstimate: number }> {
  const result = await runMemoryPipeline(MEMORY_SOURCES, ctx, budgetTokens);
  return {
    prompt: buildMemoryContextPrompt(result.entries),
    tokenEstimate: result.tokenEstimate,
  };
}

export async function commitMemorySources(ctx: MemoryCommitContext): Promise<void> {
  await runMemoryCommitPipeline(MEMORY_SOURCES, ctx);
}
