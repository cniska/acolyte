import { resolveRunnableModel } from "./agent-model";
import { createUserError } from "./error-messages";
import type { ModelResolution } from "./lifecycle-contract";

export function resolveModel(requestModel: string): ModelResolution {
  const trimmedRequestModel = requestModel.trim();
  if (!trimmedRequestModel) {
    throw createUserError("E_MODEL_NOT_CONFIGURED");
  }
  const resolved = resolveRunnableModel(trimmedRequestModel);
  if (!resolved.available) {
    throw createUserError("E_MODEL_PROVIDER_UNAVAILABLE", {
      model: resolved.model,
      provider: resolved.provider,
    });
  }
  return { model: resolved.model, provider: resolved.provider };
}
