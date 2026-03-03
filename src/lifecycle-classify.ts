import { resolveRunnableModel } from "./agent-model";
import type { AgentMode } from "./agent-modes";
import { classifyMode } from "./agent-modes";
import type { ChatRequest } from "./api";
import { appConfig } from "./app-config";
import { createUserError } from "./error-messages";
import type { ModeResolution, PhaseClassifyResult, RunContext } from "./lifecycle-contract";

export function resolveModeModelOrThrow(mode: AgentMode, requestModel: string): ModeResolution {
  const modeModel = appConfig.models[mode]?.trim();
  const requestedModel = modeModel && modeModel.length > 0 ? modeModel : requestModel.trim();
  if (!requestedModel) {
    throw createUserError("E_MODEL_NOT_CONFIGURED");
  }
  const resolved = resolveRunnableModel(requestedModel);
  if (!resolved.available) {
    throw createUserError("E_MODEL_PROVIDER_UNAVAILABLE", {
      model: resolved.model,
      provider: resolved.provider,
    });
  }
  return { model: resolved.model, provider: resolved.provider };
}

export function phaseClassify(request: ChatRequest, debug: RunContext["debug"]): PhaseClassifyResult {
  const classifiedMode = classifyMode(request.message);
  const resolved = resolveModeModelOrThrow(classifiedMode, request.model);
  debug("lifecycle.classify", { mode: classifiedMode, model: resolved.model, provider: resolved.provider });
  return { classifiedMode, model: resolved.model };
}
