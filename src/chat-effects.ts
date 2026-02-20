import { useEffect } from "react";
import { getCachedRepoPathCandidates, rankAtReferenceSuggestions } from "./chat-file-ref";

const THINKING_ANIMATION_INTERVAL_MS = 90;

export function useAtSuggestionsEffect(
  atQuery: string | null,
  setAtSuggestions: (next: string[]) => void,
  setAtSuggestionIndex: (next: number | ((current: number) => number)) => void,
): void {
  useEffect(() => {
    let cancelled = false;
    const query = atQuery;
    if (query === null) {
      setAtSuggestions([]);
      setAtSuggestionIndex(0);
      return () => {
        cancelled = true;
      };
    }
    void (async () => {
      const candidates = await getCachedRepoPathCandidates();
      if (cancelled) {
        return;
      }
      const next = rankAtReferenceSuggestions(candidates, query);
      setAtSuggestions(next);
      setAtSuggestionIndex((current) => Math.max(0, Math.min(current, Math.max(0, next.length - 1))));
    })();
    return () => {
      cancelled = true;
    };
  }, [atQuery, setAtSuggestionIndex, setAtSuggestions]);
}

export function useSlashSuggestionsEffect(
  slashSuggestions: string[],
  setSlashSuggestionIndex: (next: number | ((current: number) => number)) => void,
): void {
  useEffect(() => {
    setSlashSuggestionIndex((current) => Math.max(0, Math.min(current, Math.max(0, slashSuggestions.length - 1))));
  }, [setSlashSuggestionIndex, slashSuggestions]);
}

export function useThinkingAnimationEffect(
  isThinking: boolean,
  frameCount: number,
  setThinkingFrame: (next: number | ((current: number) => number)) => void,
): void {
  useEffect(() => {
    if (!isThinking) {
      setThinkingFrame(0);
      return;
    }
    const id = setInterval(() => {
      setThinkingFrame((current) => (current + 1) % frameCount);
    }, THINKING_ANIMATION_INTERVAL_MS);
    return () => {
      clearInterval(id);
    };
  }, [frameCount, isThinking, setThinkingFrame]);
}
