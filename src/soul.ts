import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { estimateTokens } from "./agent-input";
import { appConfig } from "./app-config";
import { loadMemoryContext } from "./memory-registry";
import type { ResourceId } from "./resource-id";

export function loadSoulPrompt(cwd = process.cwd()): string {
  const soulPath = join(cwd, "docs", "soul.md");
  if (!existsSync(soulPath)) return "";

  try {
    const content = readFileSync(soulPath, "utf8").trim();
    return content;
  } catch {
    return "";
  }
}

export function loadAgentsPrompt(cwd = process.cwd()): string {
  const agentsPath = join(cwd, "AGENTS.md");
  if (!existsSync(agentsPath)) return "";

  try {
    const content = readFileSync(agentsPath, "utf8").trim();
    if (content.length === 0) return "";
    return ["Repository Instructions (AGENTS.md):", content].join("\n");
  } catch {
    return "";
  }
}

export function loadSystemPrompt(cwd = process.cwd()): string {
  const soul = loadSoulPrompt(cwd);
  const agents = loadAgentsPrompt(cwd);
  return agents ? `${soul}\n\n${agents}` : soul;
}

export type SoulPromptResult = {
  prompt: string;
  memoryTokens: number;
};

type CreateSoulPromptOptions = {
  cwd?: string;
  sessionId?: string;
  resourceId?: ResourceId;
  workspace?: string;
  query?: string;
  useMemory?: boolean;
  memoryBudgetTokens?: number;
  onDebug?: (event: string, fields?: Record<string, unknown>) => void;
};

export function formatMemoryResumeBlock(continuation: { currentTask?: string; nextStep?: string }): string {
  const currentTask = continuation.currentTask?.trim();
  const nextStep = continuation.nextStep?.trim();
  if (!currentTask && !nextStep) return "";
  const lines = ["Resume context:"];
  if (currentTask) lines.push(`- Continue current task: ${currentTask}`);
  if (nextStep) lines.push(`- Start with next step: ${nextStep}`);
  return lines.join("\n");
}

export async function createSoulPrompt(options: CreateSoulPromptOptions = {}): Promise<SoulPromptResult> {
  const cwd = options.cwd ?? process.cwd();
  const base = loadSystemPrompt(cwd);
  const budgetTokens = options.memoryBudgetTokens ?? appConfig.memory.budgetTokens;
  const debugBaseFields = {
    budgetTokens,
    sourceStrategy: appConfig.memory.sources.join(","),
  };
  if (options.useMemory === false) {
    options.onDebug?.("lifecycle.memory.load_skipped", { ...debugBaseFields, reason: "request_disabled" });
    return { prompt: base, memoryTokens: 0 };
  }
  if (budgetTokens <= 0) {
    options.onDebug?.("lifecycle.memory.load_skipped", { ...debugBaseFields, reason: "budget_disabled" });
    return { prompt: base, memoryTokens: 0 };
  }
  const memoryContext = await loadMemoryContext(
    {
      sessionId: options.sessionId,
      resourceId: options.resourceId,
      workspace: options.workspace,
      query: options.query,
    },
    budgetTokens,
  );
  const memoryPrompt = memoryContext.prompt;
  if (!memoryPrompt) {
    options.onDebug?.("lifecycle.memory.load_empty", debugBaseFields);
    return { prompt: base, memoryTokens: 0 };
  }
  const resumeBlock = formatMemoryResumeBlock(memoryContext.continuation);
  options.onDebug?.("lifecycle.memory.load_applied", {
    ...debugBaseFields,
    tokenEstimate: memoryContext.tokenEstimate,
    entryCount: memoryContext.entryCount,
    hasContinuation: memoryContext.continuationSelected,
  });
  const prompt = resumeBlock ? `${base}\n\n${memoryPrompt}\n\n${resumeBlock}` : `${base}\n\n${memoryPrompt}`;
  return {
    prompt,
    memoryTokens: memoryContext.tokenEstimate + (resumeBlock ? estimateTokens(resumeBlock) : 0),
  };
}
