import type { Agent } from "./agent-contract";
import type { AgentMode } from "./agent-modes";
import type { ChatRequest, ChatResponse } from "./api";
import type { StreamEvent } from "./client";
import type { ErrorCategory, ErrorSource } from "./error-handling";
import type { LifecycleDebugEvent, LifecycleEventName } from "./lifecycle-events";
import type { LifecyclePolicy } from "./lifecycle-policy";
import type { Toolset } from "./tool-registry";
import type { ErrorCode } from "./tool-error-codes";
import type { SessionContext } from "./tool-guards";

export type GenerateResult = {
  text: string;
  toolCalls: unknown[];
};

export type ToolOutputEvent = { toolName: string; message: string; toolCallId?: string };
export type ToolCallStart = { toolName: string; startedAtMs: number };
export type PromptUsage = {
  promptTokens: number;
  promptBudgetTokens: number;
  promptTruncated: boolean;
  includedHistoryMessages: number;
  totalHistoryMessages: number;
};
export type StreamChunk = { type?: string; payload?: unknown };
export type TextDeltaPayload = { text?: string };
export type ToolCallPayload = { toolCallId?: string; toolName?: string; args?: Record<string, unknown> };
export type ToolResultPayload = { toolCallId?: string; toolName?: string; result?: unknown };
export type ToolErrorPayload = {
  error?: unknown;
  message?: string;
  code?: unknown;
  toolName?: string;
  toolCallId?: string;
};
export type ModeResolution = { model: string; provider: string };
export type PhaseClassifyResult = { classifiedMode: AgentMode; model: string };
export type PhasePrepareInput = {
  request: ChatRequest;
  workspace: string | undefined;
  taskId: string | undefined;
  soulPrompt: string;
  classifiedMode: AgentMode;
  model: string;
  debug: RunContext["debug"];
  onToolOutput: (event: ToolOutputEvent) => void;
};
export type PhasePrepareResult = {
  session: SessionContext;
  tools: Toolset;
  agentInput: string;
  promptUsage: PromptUsage;
};
export type GenerateOptions = { maxSteps: number; timeoutMs: number };
export type SavedRegenerationState = {
  result: GenerateResult | undefined;
  lastError: string | undefined;
  lastErrorCode: string | undefined;
  lastErrorCategory: ErrorCategory | undefined;
  lastErrorSource: ErrorSource | undefined;
  lastErrorTool: string | undefined;
};

export type LifecycleInput = {
  request: ChatRequest;
  soulPrompt: string;
  workspace?: string;
  taskId?: string;
  lifecyclePolicy?: Partial<LifecyclePolicy>;
  onEvent?: (event: StreamEvent) => void;
  onDebug?: (event: LifecycleDebugEvent) => void;
  shouldYield?: () => boolean;
};

export type RunContext = {
  readonly request: ChatRequest;
  readonly workspace: string | undefined;
  readonly taskId: string | undefined;
  readonly soulPrompt: string;
  readonly emit: (event: StreamEvent) => void;
  readonly debug: (event: LifecycleEventName, fields?: Record<string, unknown>) => void;
  readonly classifiedMode: AgentMode;
  readonly tools: Toolset;
  readonly session: SessionContext;
  readonly agentInput: string;
  readonly policy: LifecyclePolicy;
  readonly promptUsage: PromptUsage;
  model: string;
  agent: Agent;
  agentMode: AgentMode;
  mode: AgentMode;
  observedTools: Set<string>;
  modelCallCount: number;
  generationAttempt: number;
  regenerationCount: number;
  regenerationLimitHit: boolean;
  sawEditFileMultiMatchError: boolean;
  lastError?: string;
  lastErrorCode?: ErrorCode | string;
  lastErrorCategory?: ErrorCategory;
  lastErrorSource?: ErrorSource;
  lastErrorTool?: string;
  errorStats: Record<ErrorCategory, number>;
  result?: GenerateResult;
  nativeIdQueue: Map<string, string[]>;
  toolCallStartedAt: Map<string, ToolCallStart>;
  toolOutputHandler: ((event: ToolOutputEvent) => void) | null;
};

export function guardStatsFromSession(session: SessionContext): { blocked: number; flagSet: number } {
  const value = session.flags.guardStats;
  if (!value || typeof value !== "object") return { blocked: 0, flagSet: 0 };
  const stats = value as { blocked?: unknown; flagSet?: unknown };
  const blocked = typeof stats.blocked === "number" ? stats.blocked : 0;
  const flagSet = typeof stats.flagSet === "number" ? stats.flagSet : 0;
  return { blocked, flagSet };
}

export function taskScopedCallLog(session: SessionContext, taskId: string | undefined) {
  if (!taskId) return session.callLog;
  return session.callLog.filter((entry) => entry.taskId === taskId);
}

export type LifecycleResult = ChatResponse;
