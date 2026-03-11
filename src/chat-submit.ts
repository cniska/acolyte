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
  atSuggestions: string[];
  atSuggestionIndex: number;
  slashSuggestions: string[];
  slashSuggestionIndex: number;
};

export function resolveSubmitInput(input: ResolveSubmitInput): SubmitResolution {
  const query = extractAtReferenceQuery(input.value);
  if (query !== null && input.atSuggestions.length > 0) {
    const selected = input.atSuggestions[clampSuggestionIndex(input.atSuggestionIndex, input.atSuggestions.length)];
    if (shouldAutocompleteAtSubmit(input.value, selected))
      return { kind: "autocomplete", value: applyAtSuggestion(input.value, selected ?? "") };
  }

  if (query === null && input.slashSuggestions.length > 0) {
    const selected =
      input.slashSuggestions[clampSuggestionIndex(input.slashSuggestionIndex, input.slashSuggestions.length)];
    if (shouldAutocompleteSlashSubmit(input.value, selected)) return { kind: "autocomplete", value: selected ?? "" };
  }

  return { kind: "submit", value: input.value };
}

export function resolveQueueSubmit(input: { value: string; isWorking: boolean }): QueueSubmitResolution {
  const trimmed = input.value.trim();
  if (!trimmed) return { kind: "ignore" };
  if (input.isWorking) return { kind: "submit", value: trimmed };
  return { kind: "submit", value: input.value };
}

export function enqueueQueuedMessage(current: string[], next: string, policy: QueueDeliveryPolicy): string[] {
  if (policy === "all") return [...current, next];
  return [next];
}
