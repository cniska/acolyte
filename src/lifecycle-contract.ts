import type { Agent, AgentMode } from "./agent-contract";
import type { ChatRequest, ChatResponse } from "./api";
import type { StreamEvent } from "./client-contract";
import type { ErrorCode } from "./error-contract";
import type { ErrorCategory, ErrorSource } from "./error-handling";
import type { LifecyclePolicy } from "./lifecycle-policy";
import type { PromptBreakdownTotals } from "./lifecycle-usage";
import type { SessionContext } from "./tool-guards";
import type { ToolOutput } from "./tool-output-content";
import type { ToolRecovery } from "./tool-recovery";
import type { Toolset } from "./tool-registry";

export type LifecycleError = {
  message: string;
  code?: ErrorCode | string;
  category?: ErrorCategory;
  source?: ErrorSource;
  tool?: string;
  recovery?: ToolRecovery;
};

export type LifecycleEventName = `lifecycle.${string}`;

export type LifecycleDebugEvent = {
  event: LifecycleEventName;
  sequence: number;
  phaseAttempt: number;
  ts: string;
  fields?: Record<string, unknown>;
};

export type ToolCallEntry = {
  toolCallId: string;
  toolName: string;
  args: unknown;
};

export type GenerateResult = {
  text: string;
  toolCalls: ToolCallEntry[];
  signal?: LifecycleSignal;
};

export type LifecycleSignal = "done" | "no_op" | "blocked";

export type ToolOutputEvent = {
  toolName: string;
  content: ToolOutput;
  toolCallId?: string;
};

export type ToolCallStart = {
  toolName: string;
  startedAtMs: number;
  targetPaths?: string[];
};
export type PromptUsage = {
  inputTokens: number;
  inputBudgetTokens: number;
  systemPromptTokens: number;
  toolTokens: number;
  memoryTokens: number;
  messageTokens: number;
  inputTruncated: boolean;
  includedHistoryMessages: number;
  totalHistoryMessages: number;
  activeSkillName?: string;
  skillInstructionChars?: number;
};
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
export type ModelUsagePayload = {
  inputTokens?: number;
  outputTokens?: number;
};
export type StreamChunk =
  | { type: "text-delta"; payload: TextDeltaPayload }
  | { type: "reasoning-delta"; payload: TextDeltaPayload }
  | { type: "tool-call"; payload: ToolCallPayload }
  | { type: "tool-result"; payload: ToolResultPayload }
  | { type: "tool-error"; payload: ToolErrorPayload }
  | { type: "model-usage"; payload: ModelUsagePayload };
export type ModeResolution = { model: string; provider: string };
export type PhasePrepareInput = {
  request: ChatRequest;
  workspace: string | undefined;
  taskId: string | undefined;
  soulPrompt: string;
  memoryTokens?: number;
  initialMode: AgentMode;
  model: string;
  policy: LifecyclePolicy;
  debug: RunContext["debug"];
  onOutput: (event: ToolOutputEvent) => void;
};
export type PhasePrepareResult = {
  session: SessionContext;
  tools: Toolset;
  baseAgentInput: string;
  promptUsage: PromptUsage;
};
export type GenerateOptions = { cycleLimit?: number; timeoutMs: number };
export type SavedRegenerationState = {
  result: GenerateResult | undefined;
  currentError: LifecycleError | undefined;
};

export type VerifyOutcome = {
  text: string;
  error?: LifecycleError;
};

export type FeedbackSource = "guard" | "lint" | "verify" | "tool-recovery" | "repeated-failure";

export type LifecycleFeedback = {
  source: FeedbackSource;
  mode: AgentMode;
  summary: string;
  details?: string;
  instruction?: string;
};

export type LifecycleState = {
  feedback: LifecycleFeedback[];
  verifyOutcome?: VerifyOutcome;
  repeatedFailure?: {
    signature: string;
    count: number;
    status: "pending" | "surfaced";
  };
};

export type LifecycleInput = {
  request: ChatRequest;
  soulPrompt: string;
  memoryTokens?: number;
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
  readonly initialMode: AgentMode;
  readonly tools: Toolset;
  readonly session: SessionContext;
  readonly baseAgentInput: string;
  readonly policy: LifecyclePolicy;
  readonly promptUsage: PromptUsage;
  lifecycleState: LifecycleState;
  model: string;
  agent: Agent;
  agentForMode: AgentMode;
  mode: AgentMode;
  observedTools: Set<string>;
  modelCallCount: number;
  inputTokensAccum: number;
  outputTokensAccum: number;
  promptBreakdownTotals: PromptBreakdownTotals;
  streamingChars: number;
  lastUsageEmitChars: number;
  generationAttempt: number;
  regenerationCount: number;
  regenerationLimitHit: boolean;
  currentError?: LifecycleError;
  errorStats: Record<ErrorCategory, number>;
  result?: GenerateResult;
  nativeIdQueue: Map<string, string[]>;
  toolCallStartedAt: Map<string, ToolCallStart>;
  toolOutputHandler: ((event: ToolOutputEvent) => void) | null;
};

type GuardStats = { blocked: number; flagSet: number };

export function guardStatsFromSession(session: SessionContext): GuardStats {
  return { blocked: session.flags.guardStats?.blocked ?? 0, flagSet: session.flags.guardStats?.flagSet ?? 0 };
}

export type LifecycleResult = ChatResponse;
