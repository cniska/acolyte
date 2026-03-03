import { classifyMode } from "./agent-modes";
import { appConfig } from "./app-config";
import { type PhaseClassifyResult, type ModeResolution, type RunContext } from "./lifecycle-contract";
import { resolveRunnableModel } from "./agent-model";
import type { AgentMode } from "./agent-modes";
import type { ChatRequest } from "./api";

export function resolveModeModelOrThrow(mode: AgentMode, fallbackModel: string): ModeResolution {
  const requestedModel = appConfig.models[mode] ?? fallbackModel;
  const resolved = resolveRunnableModel(requestedModel);
  if (!resolved.available) {
    throw new Error("No model configured. Run /model to set one.");
  }
  return { model: resolved.model, provider: resolved.provider };
}

export function phaseClassify(request: ChatRequest, debug: RunContext["debug"]): PhaseClassifyResult {
  const classifiedMode = classifyMode(request.message);
  const resolved = resolveModeModelOrThrow(classifiedMode, request.model);
  debug("lifecycle.classify", { mode: classifiedMode, model: resolved.model, provider: resolved.provider });
  return { classifiedMode, model: resolved.model };
}
