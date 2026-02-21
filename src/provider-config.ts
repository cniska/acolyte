import type { AgentRole } from "./agent-roles";
import { appConfig } from "./app-config";

export type ProviderName = "openai" | "openai-compatible" | "mock";

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

export function presentModel(provider: ProviderName, model: string): string {
  return provider === "openai" ? normalizeModel(model) : model;
}

export function presentRoleModels(provider: ProviderName, models: RoleModelMap): RoleModelMap {
  return {
    main: presentModel(provider, models.main),
    planner: presentModel(provider, models.planner),
    coder: presentModel(provider, models.coder),
    reviewer: presentModel(provider, models.reviewer),
  };
}

export function resolveProvider(openaiApiKey: string | undefined, openaiBaseUrl: string): ProviderName {
  if (!openaiApiKey) {
    return "mock";
  }
  try {
    const host = new URL(openaiBaseUrl).hostname.toLowerCase();
    return host === "api.openai.com" ? "openai" : "openai-compatible";
  } catch {
    return "openai-compatible";
  }
}
