import type { LanguageModelV4Message } from "@ai-sdk/provider";
import { wrapInSystemReminder } from "./agent-reminders-render";
import { unreachable } from "./assert";
import type { CompletionBlock } from "./lifecycle-completion";

// Model-audience prose composed from block facts. The prompt-injection layer is the only
// legitimate home for second-person "you ended your turn…" text — it never reaches the user.
function modelFacingBlockText(block: CompletionBlock): string {
  switch (block.reason) {
    case "empty-answer":
      return "Cannot finish yet: you ended your turn without writing a final response to the user.";
    default:
      return unreachable(block.reason);
  }
}

export type FinishPolicyState = {
  completionRetryUsed: boolean;
};

export type FinishPolicyDecision =
  | { kind: "none" }
  | { kind: "completion-rejected-continue"; block: CompletionBlock }
  | { kind: "completion-block"; block: CompletionBlock };

export function createFinishPolicyState(): FinishPolicyState {
  return { completionRetryUsed: false };
}

export function decideFinish(input: {
  state: FinishPolicyState;
  completionBlock?: CompletionBlock;
}): FinishPolicyDecision {
  if (input.completionBlock) {
    if (!input.state.completionRetryUsed) {
      input.state.completionRetryUsed = true;
      return { kind: "completion-rejected-continue", block: input.completionBlock };
    }
    // Retry spent, block still standing: this is terminal. The in-stream gate owns
    // enforcement, so the caller renders the user-audience message from the block —
    // no post-hoc re-check downstream.
    return { kind: "completion-block", block: input.completionBlock };
  }

  return { kind: "none" };
}

export function renderFinishPolicyMessages(decision: FinishPolicyDecision): LanguageModelV4Message[] {
  switch (decision.kind) {
    case "completion-rejected-continue": {
      const followUp = "Write your final response to the user now.";
      return [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: wrapInSystemReminder(
                "completion-rejected",
                [modelFacingBlockText(decision.block), followUp].join(" "),
              ),
            },
          ],
        },
      ];
    }
    case "completion-block":
    case "none":
      return [];
    default:
      return unreachable(decision);
  }
}
