import { useState } from "react";
import { extractAtReferenceQuery, getCachedRepoPathCandidates, rankAtReferenceSuggestions } from "./chat-file-ref";
import { suggestSlashCommands } from "./chat-slash";
import { useAsyncEffect, useSyncEffect } from "./tui/effects";

export const SUGGESTION_LIMIT = 10;

export function clampSuggestionIndex(current: number, length: number): number {
  return Math.max(0, Math.min(current, Math.max(0, length - 1)));
}

export function useAtSuggestionsEffect(
  atQuery: string | null,
  setAtSuggestions: (next: string[]) => void,
  setAtSuggestionIndex: (next: number | ((current: number) => number)) => void,
): void {
  useAsyncEffect(
    async (cancelled) => {
      // A new query is a new candidate list, so the selection returns to the top match. Clamping
      // instead would carry an arrowed-to position onto an unrelated file.
      setAtSuggestionIndex(0);
      if (atQuery === null) {
        setAtSuggestions([]);
        return;
      }
      const candidates = await getCachedRepoPathCandidates();
      if (cancelled()) return;
      setAtSuggestions(rankAtReferenceSuggestions(candidates, atQuery, SUGGESTION_LIMIT));
    },
    [atQuery, setAtSuggestionIndex, setAtSuggestions],
  );
}

export type SuggestionsState = {
  slashSuggestions: string[];
  slashSuggestionIndex: number;
  setSlashSuggestionIndex: (next: number | ((current: number) => number)) => void;
  atQuery: string | null;
  atSuggestions: string[];
  atSuggestionIndex: number;
  setAtSuggestionIndex: (next: number | ((current: number) => number)) => void;
};

export function useSuggestions(value: string, cursor?: number): SuggestionsState {
  const slashSuggestions = suggestSlashCommands(value, SUGGESTION_LIMIT);
  const [slashSuggestionIndex, setSlashSuggestionIndex] = useState(0);
  const atQuery = extractAtReferenceQuery(value, cursor);
  const [atSuggestions, setAtSuggestions] = useState<string[]>([]);
  const [atSuggestionIndex, setAtSuggestionIndex] = useState(0);

  // Keyed on the candidates themselves, not the array identity a render rebuilds each pass, so
  // arrowing down a stable list holds while a changed list returns to the top match.
  const slashSuggestionKey = slashSuggestions.join("\n");
  useSyncEffect(() => {
    setSlashSuggestionIndex(0);
  }, [slashSuggestionKey]);

  useAtSuggestionsEffect(atQuery, setAtSuggestions, setAtSuggestionIndex);

  return {
    slashSuggestions,
    slashSuggestionIndex,
    setSlashSuggestionIndex,
    atQuery,
    atSuggestions,
    atSuggestionIndex,
    setAtSuggestionIndex,
  };
}
