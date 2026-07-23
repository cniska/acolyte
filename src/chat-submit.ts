import { clampSuggestionIndex } from "./chat-effects";
import { applyAtSuggestion, extractAtReferenceQuery, shouldAutocompleteAtSubmit } from "./chat-file-ref";
import { shouldAutocompleteSlashSubmit } from "./chat-slash";

export type SubmitResolution =
  | {
      kind: "autocomplete";
      value: string;
    }
  | {
      kind: "submit";
      value: string;
    };

export type QueueSubmitResolution =
  | {
      kind: "ignore";
    }
  | {
      kind: "submit";
      value: string;
    };

export type QueueDeliveryPolicy = "one-at-a-time" | "all";

type ResolveSubmitInput = {
  value: string;
  cursor?: number;
  atSuggestions: string[];
  atSuggestionIndex: number;
  slashSuggestions: string[];
  slashSuggestionIndex: number;
};

export function resolveSubmitInput(input: ResolveSubmitInput): SubmitResolution {
  const query = extractAtReferenceQuery(input.value, input.cursor);
  if (query !== null && input.atSuggestions.length > 0) {
    const selected = input.atSuggestions[clampSuggestionIndex(input.atSuggestionIndex, input.atSuggestions.length)];
    if (shouldAutocompleteAtSubmit(input.value, selected, input.cursor))
      return { kind: "autocomplete", value: applyAtSuggestion(input.value, selected ?? "", input.cursor) };
  }

  if (query === null && input.slashSuggestions.length > 0) {
    const selected =
      input.slashSuggestions[clampSuggestionIndex(input.slashSuggestionIndex, input.slashSuggestions.length)];
    if (shouldAutocompleteSlashSubmit(input.value, selected)) return { kind: "autocomplete", value: selected ?? "" };
  }

  return { kind: "submit", value: input.value };
}

export function resolveQueueSubmit(input: { value: string; isPending: boolean }): QueueSubmitResolution {
  const trimmed = input.value.trim();
  if (!trimmed) return { kind: "ignore" };
  if (input.isPending) return { kind: "submit", value: trimmed };
  return { kind: "submit", value: input.value };
}

export function enqueueQueuedMessage(current: string[], next: string, policy: QueueDeliveryPolicy): string[] {
  if (policy === "all") return [...current, next];
  return [next];
}

export function dequeueQueuedMessage(current: string[]): { next: string | undefined; rest: string[] } {
  const [next, ...rest] = current;
  return { next, rest };
}

// The submit runs once, outside the setQueue updater, so a StrictMode double-invoke of the
// updater cannot resubmit the queued command. Read the head from the caller's snapshot; the
// updater only drains it. submit and setQueue must stay synchronous and adjacent — an await
// between them would let a message queued in the gap be dropped by one-at-a-time replace.
export function drainQueueOnTurnEnd(params: {
  queue: string[];
  submit: (message: string) => void;
  setQueue: (updater: (current: string[]) => string[]) => void;
}): void {
  const { next } = dequeueQueuedMessage(params.queue);
  if (next === undefined) return;
  params.submit(next);
  params.setQueue((current) => dequeueQueuedMessage(current).rest);
}
