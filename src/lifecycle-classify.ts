import { resolveRunnableModel } from "./agent-model";
import type { AgentMode } from "./agent-modes";
import type { ChatRequest } from "./api";
import { appConfig } from "./app-config";
import { createUserError } from "./error-messages";
import type { ModeResolution, PhaseClassifyResult, RunContext } from "./lifecycle-contract";

export function resolveModeModel(
  mode: AgentMode,
  requestModel: string,
  modeModels?: ChatRequest["modeModels"],
): ModeResolution {
  const requestModeModel = modeModels?.[mode]?.trim();
  const configuredModeModel = appConfig.models[mode]?.trim();
  const modeModel = requestModeModel && requestModeModel.length > 0 ? requestModeModel : configuredModeModel;
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
  const classifiedMode: AgentMode = "plan";
  const resolved = resolveModeModel(classifiedMode, request.model, request.modeModels);
  debug("lifecycle.classify", { mode: classifiedMode, model: resolved.model, provider: resolved.provider });
  return { classifiedMode, model: resolved.model };
}
