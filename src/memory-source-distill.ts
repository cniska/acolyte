import { estimateTokens } from "./agent-input";
import { appConfig } from "./app-config";
import { nowIso } from "./datetime";
import type { DistillRecord, MemorySource } from "./memory-contract";
import { createFileDistillStore, type DistillStore } from "./memory-distill-store";
import { OBSERVER_PROMPT, REFLECTOR_PROMPT } from "./memory-distill-prompts";
import { createModel } from "./model-factory";
import { normalizeModel } from "./provider-config";
import { createId } from "./short-id";

const store: DistillStore = createFileDistillStore();
const REFLECTION_RETRY_LIMIT = 2;

function clampToTokenEstimate(content: string, maxTokens: number): string {
  const text = content.trim();
  if (!text) return "";
  if (maxTokens <= 0) return "";
  if (estimateTokens(text) <= maxTokens) return text;

  let clamped = text.slice(0, Math.max(1, maxTokens * 4)).trim();
  while (clamped.length > 0 && estimateTokens(clamped) > maxTokens) {
    clamped = clamped.slice(0, Math.floor(clamped.length * 0.9)).trim();
  }
  return clamped;
}

function needsReflectionRetry(reflected: string, sourceTokenEstimate: number): boolean {
  const reflectedTokens = estimateTokens(reflected);
  return reflectedTokens >= sourceTokenEstimate || reflectedTokens > appConfig.distill.reflectionThresholdTokens;
}

async function runDistillLLM(systemPrompt: string, userContent: string): Promise<string> {
  const model = createModel(normalizeModel(appConfig.distill.model));
  const result = await model.doGenerate({
    prompt: [
      { role: "system", content: systemPrompt },
      { role: "user", content: [{ type: "text", text: userContent }] },
    ],
  });
  const text = result.content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("");
  return text.trim();
}

export function createDistillMemorySource(injectedStore?: DistillStore): MemorySource {
  const ds = injectedStore ?? store;
  return {
    id: "distill",

    async load(ctx) {
      if (!ctx.sessionId) return [];
      const entries = await ds.list(ctx.sessionId);
      const reflections = entries.filter((e) => e.tier === "reflection");
      if (reflections.length > 0) {
        const latestReflection = reflections[reflections.length - 1];
        if (!latestReflection) return [];
        const observationsSinceReflection = entries
          .filter((e) => e.tier === "observation" && e.createdAt > latestReflection.createdAt)
          .map((e) => e.content);
        return [latestReflection.content, ...observationsSinceReflection];
      }
      return entries
        .filter((e) => e.tier === "observation")
        .slice()
        .reverse()
        .map((e) => e.content);
    },

    async commit(ctx) {
      if (!ctx.sessionId) return;
      if (ctx.messages.length < appConfig.distill.messageThreshold) return;

      const recentMessages = ctx.messages.slice(-20);
      const distillInput = [...recentMessages, { role: "assistant", content: ctx.output }]
        .map((m) => `${m.role}: ${m.content}`)
        .join("\n\n");
      const observedRaw = await runDistillLLM(OBSERVER_PROMPT, distillInput);
      const observed = clampToTokenEstimate(observedRaw, appConfig.distill.maxOutputTokens);
      if (!observed.trim()) return;

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
      const reflections = entries.filter((e) => e.tier === "reflection");
      const latestReflection = reflections[reflections.length - 1];
      const pendingObservations = latestReflection
        ? observations.filter((e) => e.createdAt > latestReflection.createdAt)
        : observations;
      const totalTokens = pendingObservations.reduce((sum, e) => sum + e.tokenEstimate, 0);
      if (totalTokens < appConfig.distill.reflectionThresholdTokens) return;

      const allObservations = pendingObservations.map((o) => o.content).join("\n\n---\n\n");
      let reflected = "";
      for (let attempt = 0; attempt <= REFLECTION_RETRY_LIMIT; attempt += 1) {
        const promptSuffix =
          attempt === 0
            ? ""
            : "\n\nCompression retry: keep all critical facts while reducing length and merging redundant details.";
        const reflectedRaw = await runDistillLLM(REFLECTOR_PROMPT, `${allObservations}${promptSuffix}`);
        reflected = clampToTokenEstimate(reflectedRaw, appConfig.distill.maxOutputTokens);
        if (!reflected.trim()) return;
        if (!needsReflectionRetry(reflected, totalTokens)) break;
      }
      if (needsReflectionRetry(reflected, totalTokens)) return;

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
