import type { AgentMode } from "./agent-contract";
import { resolveRunnableModel } from "./agent-model";
import type { ChatRequest } from "./api";
import { appConfig } from "./app-config";
import { createUserError } from "./error-messages";
import type { ModeResolution, RunContext } from "./lifecycle-contract";

export function resolveModeModel(
  mode: AgentMode,
  requestModel: string,
  modeModels?: ChatRequest["modeModels"],
  configuredModels?: Partial<Record<AgentMode, string>>,
): ModeResolution {
  const requestModeModel = modeModels?.[mode]?.trim();
  const configuredModeModel = (configuredModels ?? appConfig.models)[mode]?.trim();
  const trimmedRequestModel = requestModel.trim();
  let requestedModel = "";
  if (requestModeModel && requestModeModel.length > 0) {
    requestedModel = requestModeModel;
  } else if (trimmedRequestModel.length > 0) {
    requestedModel = trimmedRequestModel;
  } else if (configuredModeModel && configuredModeModel.length > 0) {
    requestedModel = configuredModeModel;
  }
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

export function resolveInitialMode(
  request: ChatRequest,
  debug: RunContext["debug"],
): { mode: AgentMode; model: string } {
  const mode: AgentMode = "work";
  const resolved = resolveModeModel(mode, request.model, request.modeModels);
  debug("lifecycle.classify", { mode, model: resolved.model, provider: resolved.provider });
  return { mode, model: resolved.model };
}
