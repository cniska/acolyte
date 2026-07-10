import type { LanguageModelV4Message } from "@ai-sdk/provider";
import type { LifecycleSignal } from "./agent-contract";
import { wrapInSystemReminder } from "./agent-reminders-render";
import { unreachable } from "./assert";
import { LIFECYCLE_ERROR_CODES } from "./error-contract";
import type { CompletionBlock } from "./lifecycle-completion";

const MISSING_SIGNAL_MESSAGE =
  "Cannot finish yet: final responses must call exactly one lifecycle signal tool (`signal_done`, `signal_noop`, or `signal_blocked`).";

// Model-audience prose composed from block facts. The prompt-injection layer is the only
// legitimate home for second-person "you called…" text — it never reaches the user.
function modelFacingBlockText(block: CompletionBlock): string {
  switch (block.reason) {
    case "empty-answer":
      return block.signal === "noop"
        ? "Cannot finish yet: you called `signal_noop` without telling the user why no changes were needed."
        : "Cannot finish yet: you called `signal_done` without writing a final response to the user.";
    case "broken-handoff":
      return `Cannot finish yet: the last \`${block.command}\` run failed (exit code ${block.exitCode}). Diagnose the failure and fix it, or call \`signal_blocked\` if recovery is genuinely impossible.`;
    case "missing-validation-after-write":
      return `Cannot finish yet: \`${block.path}\` changed and no later validation targeted it. Run a related test or command, or say why validation is blocked.`;
    default:
      return unreachable(block);
  }
}

export type FinishPolicyState = {
  completionRetryUsed: boolean;
  missingSignalRetryUsed: boolean;
};

export type FinishPolicyDecision =
  | { kind: "none" }
  | { kind: "missing-signal-continue"; message: string }
  | { kind: "missing-signal-block"; code: typeof LIFECYCLE_ERROR_CODES.unknown }
  | { kind: "completion-rejected-continue"; block: CompletionBlock };

export function createFinishPolicyState(): FinishPolicyState {
  return {
    completionRetryUsed: false,
    missingSignalRetryUsed: false,
  };
}

export function decideFinish(input: {
  state: FinishPolicyState;
  signal?: LifecycleSignal;
  completionBlock?: CompletionBlock;
}): FinishPolicyDecision {
  if (!input.signal) {
    if (!input.state.missingSignalRetryUsed) {
      input.state.missingSignalRetryUsed = true;
      return { kind: "missing-signal-continue", message: MISSING_SIGNAL_MESSAGE };
    }
    return { kind: "missing-signal-block", code: LIFECYCLE_ERROR_CODES.unknown };
  }

  if (input.completionBlock && !input.state.completionRetryUsed) {
    input.state.completionRetryUsed = true;
    // Re-opening the loop is a fresh sub-turn: the model must signal again after
    // validating, so restore its one-shot missing-signal retry — otherwise a prose
    // reply to this prompt blocks with a spent budget (the self-review-era bug).
    input.state.missingSignalRetryUsed = false;
    return { kind: "completion-rejected-continue", block: input.completionBlock };
  }

  return { kind: "none" };
}

export function renderFinishPolicyMessages(decision: FinishPolicyDecision): LanguageModelV4Message[] {
  switch (decision.kind) {
    case "missing-signal-continue":
      return [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: wrapInSystemReminder(
                "missing-signal",
                `${decision.message} Continue by calling the correct signal tool now.`,
              ),
            },
          ],
        },
      ];
    case "completion-rejected-continue": {
      const block = decision.block;
      const followUp =
        block.reason === "empty-answer"
          ? "Write your final response to the user now, then call the same signal tool again to finish."
          : "Continue autonomously: run focused validation now, then call `signal_done` again to finish — or call `signal_blocked` only if validation is genuinely impossible.";
      return [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: wrapInSystemReminder("completion-rejected", [modelFacingBlockText(block), followUp].join(" ")),
            },
          ],
        },
      ];
    }
    case "missing-signal-block":
    case "none":
      return [];
    default:
      return unreachable(decision);
  }
}
