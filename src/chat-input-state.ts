import { useCallback, useRef, useState } from "react";
import type { ChatMessage } from "./chat-contract";
import { createInputHistory } from "./chat-turn";
import {
  createInputController,
  type InputControllerState,
  type InputEditAction,
  reduceInput,
} from "./input-controller";
import { useSyncEffect } from "./tui/effects";

export type InputState = {
  input: InputControllerState;
  dispatch: (action: InputEditAction) => void;
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
  const [input, setInput] = useState<InputControllerState>(() => createInputController());
  const [inputRevision, setInputRevision] = useState(0);
  const [inputHistoryIndex, setInputHistoryIndex] = useState(-1);
  const [inputHistoryDraft, setInputHistoryDraft] = useState("");
  const applyingHistoryRef = useRef(false);
  const [inputHistory, setInputHistory] = useState<string[]>([]);

  const dispatch = useCallback((action: InputEditAction) => setInput((current) => reduceInput(current, action)), []);
  const setValue = useCallback((next: string) => dispatch({ kind: "replace", text: next }), [dispatch]);

  useSyncEffect(() => {
    setInputHistory(createInputHistory(messages));
    setInputHistoryIndex(-1);
    setInputHistoryDraft("");
  }, [messages]);

  return {
    input,
    dispatch,
    value: input.text,
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
