import { useCallback, useRef } from "react";
import { type InputControllerState, type InputEditAction, reduceInput } from "./input-controller";
import { cursorLineIndex } from "./prompt-display";
import { consumesMetaPrefix, resolvePromptAction, resolvePromptEdit } from "./prompt-keymap";
import { useInput } from "./tui";

const META_PREFIX_WINDOW_MS = 150;

interface PromptInputProps {
  value: string;
  cursor: number;
  onAction: (action: InputEditAction, fromPaste: boolean) => void;
  onSubmit: (value: string) => void;
  onCursorLine: (line: number) => void;
  wrapWidth?: number;
}

export function PromptInputHandler({
  value,
  cursor,
  onAction,
  onSubmit,
  onCursorLine,
  wrapWidth,
}: PromptInputProps): null {
  const metaPrefixAt = useRef<number | null>(null);
  const onSubmitRef = useRef(onSubmit);
  const onCursorLineRef = useRef(onCursorLine);
  const onActionRef = useRef(onAction);
  const wrapWidthRef = useRef(wrapWidth);
  // stateRef is the source of truth for keystroke handling: props can lag a
  // render behind, so each render overwrites it and keystrokes between renders
  // reduce against it in turn.
  const fromProps: InputControllerState = { text: value, cursor: Math.max(0, Math.min(cursor, value.length)) };
  const stateRef = useRef(fromProps);
  onSubmitRef.current = onSubmit;
  onCursorLineRef.current = onCursorLine;
  onActionRef.current = onAction;
  wrapWidthRef.current = wrapWidth;
  stateRef.current = fromProps;

  const handleInput = useCallback((input: string, key: Parameters<Parameters<typeof useInput>[0]>[1]) => {
    const now = Date.now();
    const hasMetaPrefix = metaPrefixAt.current !== null && now - metaPrefixAt.current <= META_PREFIX_WINDOW_MS;
    if (key.escape && !input) {
      metaPrefixAt.current = now;
      return;
    }

    const action = resolvePromptAction(input, key, { hasMetaPrefix });
    const decision = resolvePromptEdit(action, stateRef.current, wrapWidthRef.current);
    if (consumesMetaPrefix(action)) metaPrefixAt.current = null;
    if (decision.kind === "submit") {
      onSubmitRef.current(stateRef.current.text);
      return;
    }
    if (decision.kind === "none") return;

    const next = reduceInput(stateRef.current, decision.action);
    stateRef.current = next;
    onActionRef.current(decision.action, action.type === "insert" && action.paste);
    onCursorLineRef.current(cursorLineIndex(next.text, next.cursor, wrapWidthRef.current));
  }, []);

  useInput(handleInput);

  return null;
}
