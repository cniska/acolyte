import type React from "react";
import { useCallback, useRef, useState } from "react";
import { unreachable } from "./assert";
import {
  type InputControllerState,
  type InputEditAction,
  reduceInput,
  wordBoundaryLeft,
  wordBoundaryRight,
} from "./input-controller";
import { buildPromptDisplayLines, cursorLineIndex, moveLineDown, moveLineUp, softWrapLine } from "./prompt-display";
import type { PromptAction } from "./prompt-keymap";
import { resolvePromptAction } from "./prompt-keymap";
import { Box, Text, useInput } from "./tui";

const META_PREFIX_WINDOW_MS = 150;

interface PromptInputProps {
  value: string;
  cursor?: number;
  placeholder?: string;
  focus?: boolean;
  caretVisible?: boolean;
  linePrefixFirst?: string;
  linePrefixRest?: string;
  onChange?: (next: string, fromPaste?: boolean) => void;
  onAction?: (action: InputEditAction, fromPaste: boolean) => void;
  onSubmit: (value: string) => void;
  onCursorLine: (line: number) => void;
  wrapWidth?: number;
}

export function PromptInput({
  value,
  cursor,
  placeholder = "",
  focus = true,
  caretVisible = true,
  linePrefixFirst = "",
  linePrefixRest = "",
  onChange,
  onAction,
  onSubmit,
  onCursorLine,
  wrapWidth,
}: PromptInputProps): React.JSX.Element {
  const controlled = onAction !== undefined && cursor !== undefined;
  const [cursorOffset, setCursorOffset] = useState(value.length);
  const metaPrefixAt = useRef<number | null>(null);
  const valueRef = useRef(value);
  // cursorRef is the source of truth for keystroke handling — only updated
  // by moveCursor (synchronous) during input, never from React state which
  // can lag behind between re-renders. For external value changes (e.g.
  // history navigation), we clamp synchronously during render.
  const cursorRef = useRef(cursorOffset);
  const onChangeRef = useRef(onChange);
  const onSubmitRef = useRef(onSubmit);
  const onCursorLineRef = useRef(onCursorLine);
  const onActionRef = useRef(onAction);
  const controlledStateRef = useRef<InputControllerState>({ text: value, cursor: value.length });
  onCursorLineRef.current = onCursorLine;
  onActionRef.current = onAction;
  const wrapWidthRef = useRef(wrapWidth);
  wrapWidthRef.current = wrapWidth;
  if (controlled) {
    controlledStateRef.current = { text: value, cursor: Math.max(0, Math.min(cursor ?? value.length, value.length)) };
  } else if (valueRef.current !== value) {
    const clamped = Math.max(0, Math.min(cursorRef.current, value.length));
    cursorRef.current = clamped;
    if (cursorOffset !== clamped) setCursorOffset(clamped);
  }
  valueRef.current = value;
  onChangeRef.current = onChange;
  onSubmitRef.current = onSubmit;

  const handleControlledInput = useCallback((input: string, key: Parameters<Parameters<typeof useInput>[0]>[1]) => {
    const dispatchAction = (action: InputEditAction, fromPaste = false) => {
      const next = reduceInput(controlledStateRef.current, action);
      controlledStateRef.current = next;
      onActionRef.current?.(action, fromPaste);
      onCursorLineRef.current(cursorLineIndex(next.text, next.cursor, wrapWidthRef.current));
    };
    const { text: v, cursor: c } = controlledStateRef.current;
    const now = Date.now();
    const hasMetaPrefix = metaPrefixAt.current !== null && now - metaPrefixAt.current <= META_PREFIX_WINDOW_MS;
    if (key.escape && !input) {
      metaPrefixAt.current = now;
      return;
    }
    const action: PromptAction = resolvePromptAction(input, key, { hasMetaPrefix });
    switch (action.type) {
      case "noop":
        metaPrefixAt.current = null;
        return;
      case "submit":
        onSubmitRef.current(v);
        return;
      case "move_home":
        dispatchAction({ kind: "move", direction: "home" });
        return;
      case "move_end":
        dispatchAction({ kind: "move", direction: "end" });
        return;
      case "move_word_left":
        dispatchAction({ kind: "move-word", direction: "left" });
        return;
      case "move_word_right":
        dispatchAction({ kind: "move-word", direction: "right" });
        return;
      case "delete_word_back":
        metaPrefixAt.current = null;
        if (c === 0) return;
        dispatchAction({ kind: "delete-word-backward" });
        return;
      case "clear_line":
        metaPrefixAt.current = null;
        if (v.length === 0) return;
        dispatchAction({ kind: "clear" });
        return;
      case "move_left":
        dispatchAction({ kind: "move", direction: "left" });
        return;
      case "move_right":
        dispatchAction({ kind: "move", direction: "right" });
        return;
      case "move_up":
        dispatchAction({ kind: "set-cursor", cursor: moveLineUp(v, c, wrapWidthRef.current) });
        return;
      case "move_down":
        dispatchAction({ kind: "set-cursor", cursor: moveLineDown(v, c, wrapWidthRef.current) });
        return;
      case "delete_back":
        metaPrefixAt.current = null;
        if (c === 0) return;
        dispatchAction({ kind: "delete-backward" });
        return;
      case "delete_forward":
        metaPrefixAt.current = null;
        if (c >= v.length) return;
        dispatchAction({ kind: "delete-forward" });
        return;
      case "insert":
        metaPrefixAt.current = null;
        if (v.length === 0 && action.text === "?" && !key.paste) return;
        dispatchAction({ kind: "insert", text: action.text }, key.paste);
        return;
      default:
        unreachable(action);
    }
  }, []);

  const handleInput = useCallback((input: string, key: Parameters<Parameters<typeof useInput>[0]>[1]) => {
    const emitChange = (next: string, fromPaste = false) => {
      valueRef.current = next;
      onChangeRef.current?.(next, fromPaste);
    };
    const moveCursor = (next: number) => {
      cursorRef.current = next;
      setCursorOffset(next);
      onCursorLineRef.current(cursorLineIndex(valueRef.current, next, wrapWidthRef.current));
    };

    const v = valueRef.current;
    const c = cursorRef.current;
    const now = Date.now();
    const hasMetaPrefix = metaPrefixAt.current !== null && now - metaPrefixAt.current <= META_PREFIX_WINDOW_MS;
    if (key.escape && !input) {
      metaPrefixAt.current = now;
      return;
    }

    const action: PromptAction = resolvePromptAction(input, key, { hasMetaPrefix });
    switch (action.type) {
      case "noop":
        metaPrefixAt.current = null;
        return;
      case "submit":
        onSubmitRef.current(v);
        return;
      case "move_home":
        moveCursor(0);
        return;
      case "move_end":
        moveCursor(v.length);
        return;
      case "move_word_left":
        moveCursor(wordBoundaryLeft(v, c));
        return;
      case "move_word_right":
        moveCursor(wordBoundaryRight(v, c));
        return;
      case "delete_word_back": {
        metaPrefixAt.current = null;
        if (c === 0) return;
        const next = wordBoundaryLeft(v, c);
        emitChange(`${v.slice(0, next)}${v.slice(c)}`);
        moveCursor(next);
        return;
      }
      case "clear_line":
        metaPrefixAt.current = null;
        if (v.length === 0) return;
        emitChange("");
        moveCursor(0);
        return;
      case "move_left":
        moveCursor(Math.max(0, c - 1));
        return;
      case "move_right":
        moveCursor(Math.min(v.length, c + 1));
        return;
      case "move_up":
        moveCursor(moveLineUp(v, c, wrapWidthRef.current));
        return;
      case "move_down":
        moveCursor(moveLineDown(v, c, wrapWidthRef.current));
        return;
      case "delete_back":
        metaPrefixAt.current = null;
        if (c === 0) return;
        emitChange(`${v.slice(0, c - 1)}${v.slice(c)}`);
        moveCursor(c - 1);
        return;
      case "delete_forward":
        metaPrefixAt.current = null;
        if (c >= v.length) return;
        emitChange(`${v.slice(0, c)}${v.slice(c + 1)}`);
        return;
      case "insert":
        metaPrefixAt.current = null;
        emitChange(`${v.slice(0, c)}${action.text}${v.slice(c)}`, key.paste);
        moveCursor(c + action.text.length);
        return;
      default:
        unreachable(action);
    }
  }, []);

  useInput(controlled ? handleControlledInput : handleInput, { isActive: focus });

  if (value.length === 0 && placeholder.length > 0) {
    return (
      <Text>
        {linePrefixFirst}
        {focus ? (
          <>
            <Text inverse={caretVisible} dimColor={!caretVisible}>
              {placeholder[0] ?? " "}
            </Text>
            <Text dimColor>{placeholder.slice(1)}</Text>
          </>
        ) : (
          <Text dimColor>{placeholder}</Text>
        )}
      </Text>
    );
  }

  if (!focus) {
    const logicalLines = value.split("\n");
    const allSegments: string[] = [];
    for (const line of logicalLines) {
      const wrapped = wrapWidth ? softWrapLine(line, wrapWidth) : [line];
      allSegments.push(...wrapped);
    }
    let lineOffset = 0;
    const readonlyLines = allSegments.map((line) => {
      const key = `prompt-readonly-line-${lineOffset}-${line}`;
      lineOffset += line.length + 1;
      return { key, line };
    });
    return (
      <Box flexDirection="column">
        {readonlyLines.map((entry, index) => (
          <Text key={entry.key}>
            {index === 0 ? linePrefixFirst : linePrefixRest}
            {entry.line}
          </Text>
        ))}
      </Box>
    );
  }
  const effectiveCursor = controlled ? controlledStateRef.current.cursor : cursorOffset;
  const lines = buildPromptDisplayLines(value, effectiveCursor, wrapWidth);
  let lineOffset = 0;
  const focusLines = lines.map((line) => {
    const content = `${line.before}${line.cursor ?? ""}${line.after}`;
    const key = `prompt-focus-line-${lineOffset}-${content}`;
    lineOffset += content.length + 1;
    return { key, line };
  });

  return (
    <Box flexDirection="column">
      {focusLines.map((entry, index) => (
        <Text key={entry.key}>
          {index === 0 ? linePrefixFirst : linePrefixRest}
          {entry.line.before}
          {entry.line.cursor !== null ? <Text inverse={caretVisible}>{entry.line.cursor}</Text> : null}
          {entry.line.after}
        </Text>
      ))}
    </Box>
  );
}
