import { applyAtSuggestion, extractAtReferenceQuery, shouldAutocompleteAtSubmit } from "./chat-file-ref";
import { applySlashSuggestion, shouldAutocompleteSlashSubmit } from "./chat-slash";

export type SubmitResolution =
  | {
      kind: "autocomplete";
      value: string;
    }
  | {
      kind: "submit";
      value: string;
    };

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
    const selected =
      input.atSuggestions[Math.max(0, Math.min(input.atSuggestionIndex, input.atSuggestions.length - 1))];
    if (shouldAutocompleteAtSubmit(input.value, selected)) {
      return { kind: "autocomplete", value: applyAtSuggestion(input.value, selected ?? "") };
    }
  }

  if (query === null && input.slashSuggestions.length > 0) {
    const selected =
      input.slashSuggestions[Math.max(0, Math.min(input.slashSuggestionIndex, input.slashSuggestions.length - 1))];
    if (shouldAutocompleteSlashSubmit(input.value, selected)) {
      return { kind: "autocomplete", value: applySlashSuggestion(selected ?? "") };
    }
  }

  return { kind: "submit", value: input.value };
}
