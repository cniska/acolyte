import type { LanguageModelV4FinishReason, LanguageModelV4Message } from "@ai-sdk/provider";
import { z } from "zod";
import { wrapInSystemReminder } from "./agent-reminders-render";
import { unreachable } from "./assert";

type UnifiedFinishReason = LanguageModelV4FinishReason["unified"];

// Recoverable: the model never finished this turn, so reopening once may complete it.
export const reopenReasonSchema = z.enum(["empty-answer", "truncated"]);
// Unrecoverable: reissuing the same request cannot help (a filter refuses again; a provider
// error was never the model's doing), so the turn ends with an honest error.
export const failReasonSchema = z.enum(["content-filter", "provider-error"]);
export type ReopenReason = z.infer<typeof reopenReasonSchema>;
export type FailReason = z.infer<typeof failReasonSchema>;
export type FinishErrorReason = ReopenReason | FailReason;

export type TerminalStep = { finalText: string; finishReason?: UnifiedFinishReason };

type Classification =
  | { kind: "accept" }
  | { kind: "incomplete"; reason: ReopenReason }
  | { kind: "failed"; reason: FailReason };

// `finishReason` is a provider fact the model cannot see; classify `length` as truncated before
// the blank check, since a length-cut step can be blank when the budget went to reasoning tokens.
export function classifyTerminalStep(step: TerminalStep): Classification {
  switch (step.finishReason) {
    case "content-filter":
      return { kind: "failed", reason: "content-filter" };
    case "error":
      return { kind: "failed", reason: "provider-error" };
    case "length":
      return { kind: "incomplete", reason: "truncated" };
    default:
      break;
  }
  if (step.finalText.trim().length === 0) return { kind: "incomplete", reason: "empty-answer" };
  return { kind: "accept" };
}

export type FinishPolicyState = { reopened: Partial<Record<ReopenReason, boolean>> };

export function createFinishPolicyState(): FinishPolicyState {
  return { reopened: {} };
}

export type FinishDecision =
  | { kind: "finish" }
  | { kind: "reopen"; reason: ReopenReason }
  | { kind: "error"; reason: FinishErrorReason };

export function decideFinish(input: { state: FinishPolicyState; step: TerminalStep }): FinishDecision {
  const classification = classifyTerminalStep(input.step);
  switch (classification.kind) {
    case "accept":
      return { kind: "finish" };
    case "failed":
      return { kind: "error", reason: classification.reason };
    case "incomplete": {
      const { reason } = classification;
      if (input.state.reopened[reason]) return { kind: "error", reason };
      input.state.reopened[reason] = true;
      return { kind: "reopen", reason };
    }
    default:
      return unreachable(classification);
  }
}

// Model-audience prose, composed only for reopen verdicts. The prompt-injection layer is the
// only legitimate home for second-person "you ended your turn…" text — it never reaches the user.
function reopenNudge(reason: ReopenReason): string {
  switch (reason) {
    case "empty-answer":
      return "Cannot finish yet: you ended your turn without writing a final response to the user. Write your final response to the user now.";
    case "truncated":
      return "Your previous response was cut off by the output-token limit. Continue exactly from where it stopped, without repeating text or adding a preamble.";
    default:
      return unreachable(reason);
  }
}

export function renderReopenMessages(decision: FinishDecision): LanguageModelV4Message[] {
  if (decision.kind !== "reopen") return [];
  return [
    {
      role: "user",
      content: [{ type: "text", text: wrapInSystemReminder("completion-rejected", reopenNudge(decision.reason)) }],
    },
  ];
}
