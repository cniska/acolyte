import { useEffect } from "react";
import { getCachedRepoPathCandidates, rankAtReferenceSuggestions } from "./chat-file-ref";

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
  useEffect(() => {
    let cancelled = false;
    if (atQuery === null) {
      setAtSuggestions([]);
      setAtSuggestionIndex(0);
      return () => {
        cancelled = true;
      };
    }
    void (async () => {
      const candidates = await getCachedRepoPathCandidates();
      if (cancelled) return;
      const next = rankAtReferenceSuggestions(candidates, atQuery);
      setAtSuggestions(next);
      setAtSuggestionIndex((current) => clampSuggestionIndex(current, next.length));
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
    setSlashSuggestionIndex((current) => clampSuggestionIndex(current, slashSuggestions.length));
  }, [setSlashSuggestionIndex, slashSuggestions]);
}

export function useThinkingAnimationEffect(
  isPending: boolean,
  frameCount: number,
  setThinkingFrame: (next: number | ((current: number) => number)) => void,
): void {
  useEffect(() => {
    if (!isPending) {
      setThinkingFrame(0);
      return;
    }
    const id = setInterval(() => {
      setThinkingFrame((current) => nextThinkingFrame(current, frameCount));
    }, THINKING_ANIMATION_INTERVAL_MS);
    return () => {
      clearInterval(id);
    };
  }, [frameCount, isPending, setThinkingFrame]);
}
