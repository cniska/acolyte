import type { AgentRole } from "./agent-roles";
import { appConfig } from "./app-config";

export type ProviderName = "openai" | "openai-compatible" | "anthropic" | "gemini" | "mock";
export type ModelProviderName = ProviderName;

export type RoleModelMap = {
  lead: string;
  planner: string;
  coder: string;
  reviewer: string;
};

function inferUnqualifiedModelPrefix(model: string): "openai" | "anthropic" | "gemini" {
  const normalized = model.trim().toLowerCase();
  if (normalized.startsWith("claude")) {
    return "anthropic";
  }
  if (normalized.startsWith("gemini")) {
    return "gemini";
  }
  return "openai";
}

export function normalizeModel(model: string): string {
  if (model.includes("/")) {
    return model;
  }
  const prefix = inferUnqualifiedModelPrefix(model);
  return `${prefix}/${model}`;
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

export function resolveRoleModels(leadModel = appConfig.models.lead): RoleModelMap {
  return {
    lead: leadModel,
    planner: appConfig.models.planner ?? leadModel,
    coder: appConfig.models.coder ?? leadModel,
    reviewer: appConfig.models.reviewer ?? leadModel,
  };
}

export function presentModel(model: string): string {
  return normalizeModel(model);
}

export function presentRoleModels(models: RoleModelMap): RoleModelMap {
  return {
    lead: presentModel(models.lead),
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
  const trimmedModel = model.trim();
  const normalizedModel = trimmedModel.toLowerCase();
  if (!normalizedModel.includes("/")) {
    if (normalizedModel.startsWith("claude")) {
      return "anthropic";
    }
    if (normalizedModel.startsWith("gemini")) {
      return "gemini";
    }
  }

  const prefix = trimmedModel.split("/", 1)[0]?.toLowerCase();
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
