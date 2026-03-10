import type { Agent, AgentMode } from "./agent-contract";
import type { ChatRequest, ChatResponse } from "./api";
import type { StreamEvent } from "./client-contract";
import type { ErrorCategory, ErrorSource } from "./error-handling";
import type { LifecyclePolicy } from "./lifecycle-policy";
import type { ErrorCode } from "./tool-error-codes";
import type { SessionContext } from "./tool-guards";
import type { ToolOutput } from "./tool-output-content";
import type { Toolset } from "./tool-registry";

export type LifecycleEventName = `lifecycle.${string}`;

export type LifecycleDebugEvent = {
  event: LifecycleEventName;
  sequence: number;
  phaseAttempt: number;
  ts: string;
  fields?: Record<string, unknown>;
};

export type GenerateResult = {
  text: string;
  toolCalls: unknown[];
};

export type ToolOutputEvent = { toolName: string; content: ToolOutput; toolCallId?: string };
export type ToolCallStart = { toolName: string; startedAtMs: number };
export type PromptUsage = {
  promptTokens: number;
  promptBudgetTokens: number;
  promptTruncated: boolean;
  includedHistoryMessages: number;
  totalHistoryMessages: number;
  activeSkillName?: string;
  skillInstructionChars?: number;
};
export type StreamChunk = { type?: string; payload?: unknown };
export type TextDeltaPayload = { text?: string };
export type ToolCallPayload = { toolCallId?: string; toolName?: string; args?: Record<string, unknown> };
export type ToolResultPayload = { toolCallId?: string; toolName?: string; result?: unknown };
export type ToolErrorPayload = {
  error?: unknown;
  message?: string;
  code?: unknown;
  kind?: unknown;
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
  onOutput: (event: ToolOutputEvent) => void;
};
export type PhasePrepareResult = {
  session: SessionContext;
  tools: Toolset;
  agentInput: string;
  promptUsage: PromptUsage;
};
export type GenerateOptions = { cycleLimit?: number; timeoutMs: number };
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
  /** Original mode determined by the classify phase (immutable). */
  readonly classifiedMode: AgentMode;
  readonly tools: Toolset;
  readonly session: SessionContext;
  readonly agentInput: string;
  readonly policy: LifecyclePolicy;
  readonly promptUsage: PromptUsage;
  model: string;
  agent: Agent;
  /** Mode the current agent instance was created for (used to detect when to recreate). */
  agentMode: AgentMode;
  /** Current working mode — changes during evaluation (e.g. plan → work → verify). */
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

type GuardStats = { blocked: number; flagSet: number };

export function guardStatsFromSession(session: SessionContext): GuardStats {
  const value = session.flags.guardStats as GuardStats | undefined;
  return { blocked: value?.blocked ?? 0, flagSet: value?.flagSet ?? 0 };
}

export function taskScopedCallLog(session: SessionContext, taskId: string | undefined) {
  if (!taskId) return session.callLog;
  return session.callLog.filter((entry) => entry.taskId === taskId);
}

export function haveChangesBeenVerified(session: SessionContext, taskId: string | undefined): boolean {
  return taskScopedCallLog(session, taskId).some(
    (entry) => entry.toolName === "run-command" && entry.mode === "verify",
  );
}

export type LifecycleResult = ChatResponse;
