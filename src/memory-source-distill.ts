import { Agent } from "@mastra/core/agent";
import { appConfig } from "./app-config";
import { nowIso } from "./datetime";
import type { DistillRecord, MemorySource } from "./memory-contract";
import { createFileDistillStore, type DistillStore } from "./memory-distill-store";
import { OBSERVER_PROMPT, REFLECTOR_PROMPT } from "./memory-distill-prompts";
import { normalizeModel } from "./provider-config";
import { createId } from "./short-id";
import { estimateTokens } from "./agent-input";

const store: DistillStore = createFileDistillStore();

async function runDistillLLM(systemPrompt: string, userContent: string): Promise<string> {
  const model = appConfig.distill.model;
  const agent = new Agent({
    id: "distill",
    name: "Distill",
    instructions: systemPrompt,
    model: normalizeModel(model),
    maxRetries: 1,
  });
  const result = await agent.generate(userContent, { maxSteps: 1 });
  return result.text.trim();
}

export function createDistillMemorySource(injectedStore?: DistillStore): MemorySource {
  const ds = injectedStore ?? store;
  return {
    id: "distill",

    async load(ctx) {
      if (!ctx.sessionId) return [];
      const entries = await ds.list(ctx.sessionId);
      const reflections = entries.filter((e) => e.tier === "reflection");
      if (reflections.length > 0) return reflections.map((e) => e.content);
      return entries.map((e) => e.content);
    },

    async commit(ctx) {
      if (!ctx.sessionId) return;
      if (ctx.messages.length < appConfig.distill.messageThreshold) return;

      const recentMessages = ctx.messages.slice(-20);
      const conversationText = recentMessages.map((m) => `${m.role}: ${m.content}`).join("\n\n");
      const observed = await runDistillLLM(OBSERVER_PROMPT, conversationText);
      if (!observed) return;

      const observation: DistillRecord = {
        id: `dst_${createId()}`,
        sessionId: ctx.sessionId,
        tier: "observation",
        content: observed,
        createdAt: nowIso(),
        tokenEstimate: estimateTokens(observed),
      };
      await ds.write(observation);

      const entries = await ds.list(ctx.sessionId);
      const observations = entries.filter((e) => e.tier === "observation");
      const totalTokens = observations.reduce((sum, e) => sum + e.tokenEstimate, 0);
      if (totalTokens < appConfig.distill.reflectionThresholdTokens) return;

      const allObservations = observations.map((o) => o.content).join("\n\n---\n\n");
      const reflected = await runDistillLLM(REFLECTOR_PROMPT, allObservations);
      if (!reflected) return;

      const reflection: DistillRecord = {
        id: `dst_${createId()}`,
        sessionId: ctx.sessionId,
        tier: "reflection",
        content: reflected,
        createdAt: nowIso(),
        tokenEstimate: estimateTokens(reflected),
      };
      await ds.write(reflection);
    },
  };
}

export const distillMemorySource: MemorySource = createDistillMemorySource();
