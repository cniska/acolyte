import type { AgentRole } from "./agent-roles";
import { appConfig } from "./app-config";

export type ProviderName = "openai" | "openai-compatible" | "anthropic" | "gemini" | "mock";
export type ModelProviderName = ProviderName;

export type RoleModelMap = {
  main: string;
  planner: string;
  coder: string;
  reviewer: string;
};

export function normalizeModel(model: string): string {
  return model.includes("/") ? model : `openai/${model}`;
}

export function resolveRoleModel(
  role: AgentRole,
  requestedModel: string,
  overrides: {
    planner?: string;
    coder?: string;
    reviewer?: string;
  } = appConfig.models,
): string {
  const override = role === "planner" ? overrides.planner : role === "coder" ? overrides.coder : overrides.reviewer;
  return override ?? requestedModel;
}

export function resolveRoleModels(mainModel = appConfig.models.main): RoleModelMap {
  return {
    main: mainModel,
    planner: appConfig.models.planner ?? mainModel,
    coder: appConfig.models.coder ?? mainModel,
    reviewer: appConfig.models.reviewer ?? mainModel,
  };
}

export function presentModel(model: string): string {
  return normalizeModel(model);
}

export function presentRoleModels(models: RoleModelMap): RoleModelMap {
  return {
    main: presentModel(models.main),
    planner: presentModel(models.planner),
    coder: presentModel(models.coder),
    reviewer: presentModel(models.reviewer),
  };
}

export function resolveProvider(openaiApiKey: string | undefined, openaiBaseUrl: string): ProviderName {
  try {
    const host = new URL(openaiBaseUrl).hostname.toLowerCase();
    if (host === "api.openai.com") {
      return openaiApiKey ? "openai" : "mock";
    }
    return "openai-compatible";
  } catch {
    return "openai-compatible";
  }
}

export function providerFromModel(model: string): ModelProviderName {
  const normalized = model.trim().toLowerCase();
  if (!normalized.includes("/")) {
    if (normalized.startsWith("claude")) {
      return "anthropic";
    }
    if (normalized.startsWith("gemini")) {
      return "gemini";
    }
  }

  const prefix = model.split("/", 1)[0]?.toLowerCase();
  if (prefix === "anthropic") {
    return "anthropic";
  }
  if (prefix === "gemini" || prefix === "google") {
    return "gemini";
  }
  if (prefix === "openai-compatible") {
    return "openai-compatible";
  }
  if (prefix === "mock") {
    return "mock";
  }
  return "openai";
}

export function isProviderAvailable(input: {
  provider: ModelProviderName;
  openaiApiKey?: string;
  openaiBaseUrl: string;
  anthropicApiKey?: string;
  googleApiKey?: string;
}): boolean {
  if (input.provider === "anthropic") {
    return Boolean(input.anthropicApiKey);
  }
  if (input.provider === "gemini") {
    return Boolean(input.googleApiKey);
  }
  if (input.provider === "mock") {
    return false;
  }
  if (input.provider === "openai-compatible") {
    return true;
  }
  return resolveProvider(input.openaiApiKey, input.openaiBaseUrl) !== "mock";
}
