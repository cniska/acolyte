import { useRef, useState } from "react";
import type { ChatMessage } from "./chat-contract";
import { createInputHistory } from "./chat-turn";
import { useSyncEffect } from "./tui/effects";

export type InputState = {
  value: string;
  setValue: (next: string) => void;
  inputRevision: number;
  setInputRevision: (next: number | ((current: number) => number)) => void;
  inputHistory: string[];
  setInputHistory: (updater: (current: string[]) => string[]) => void;
  inputHistoryIndex: number;
  setInputHistoryIndex: (next: number | ((current: number) => number)) => void;
  inputHistoryDraft: string;
  setInputHistoryDraft: (next: string) => void;
  applyingHistoryRef: { current: boolean };
};

export function useInputState(messages: ChatMessage[]): InputState {
  const [value, setValue] = useState("");
  const [inputRevision, setInputRevision] = useState(0);
  const [inputHistoryIndex, setInputHistoryIndex] = useState(-1);
  const [inputHistoryDraft, setInputHistoryDraft] = useState("");
  const applyingHistoryRef = useRef(false);
  const [inputHistory, setInputHistory] = useState<string[]>([]);

  useSyncEffect(() => {
    setInputHistory(createInputHistory(messages));
    setInputHistoryIndex(-1);
    setInputHistoryDraft("");
  }, [messages]);

  return {
    value,
    setValue,
    inputRevision,
    setInputRevision,
    inputHistory,
    setInputHistory,
    inputHistoryIndex,
    setInputHistoryIndex,
    inputHistoryDraft,
    setInputHistoryDraft,
    applyingHistoryRef,
  };
}
