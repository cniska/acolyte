import { useState } from "react";
import { extractAtReferenceQuery, getCachedRepoPathCandidates, rankAtReferenceSuggestions } from "./chat-file-ref";
import { suggestSlashCommands } from "./chat-slash";
import { useAsyncEffect, useInterval, useSyncEffect } from "./tui/effects";

const THINKING_ANIMATION_INTERVAL_MS = 60;

export function clampSuggestionIndex(current: number, length: number): number {
  return Math.max(0, Math.min(current, Math.max(0, length - 1)));
}

export function nextThinkingFrame(current: number, frameCount: number): number {
  return (current + 1) % frameCount;
}

export function useAtSuggestionsEffect(
  atQuery: string | null,
  setAtSuggestions: (next: string[]) => void,
  setAtSuggestionIndex: (next: number | ((current: number) => number)) => void,
): void {
  useAsyncEffect(
    async (cancelled) => {
      if (atQuery === null) {
        setAtSuggestions([]);
        setAtSuggestionIndex(0);
        return;
      }
      const candidates = await getCachedRepoPathCandidates();
      if (cancelled()) return;
      const next = rankAtReferenceSuggestions(candidates, atQuery);
      setAtSuggestions(next);
      setAtSuggestionIndex((current) => clampSuggestionIndex(current, next.length));
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

export function useSuggestions(value: string): SuggestionsState {
  const slashSuggestions = suggestSlashCommands(value);
  const [slashSuggestionIndex, setSlashSuggestionIndex] = useState(0);
  const atQuery = extractAtReferenceQuery(value);
  const [atSuggestions, setAtSuggestions] = useState<string[]>([]);
  const [atSuggestionIndex, setAtSuggestionIndex] = useState(0);

  useSyncEffect(() => {
    setSlashSuggestionIndex((current) => clampSuggestionIndex(current, slashSuggestions.length));
  }, [slashSuggestions]);

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

export function useThinkingAnimationEffect(
  isPending: boolean,
  frameCount: number,
  setThinkingFrame: (next: number | ((current: number) => number)) => void,
): void {
  useInterval(
    () => setThinkingFrame((current) => nextThinkingFrame(current, frameCount)),
    isPending ? THINKING_ANIMATION_INTERVAL_MS : null,
  );
}
