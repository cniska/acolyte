import type React from "react";
import { useCallback, useRef, useState } from "react";
import { unreachable } from "./assert";
import type { PromptAction } from "./prompt-keymap";
import { resolvePromptAction } from "./prompt-keymap";
import { Box, Text, useInput } from "./tui";

const META_PREFIX_WINDOW_MS = 150;

interface PromptInputProps {
  value: string;
  placeholder?: string;
  focus?: boolean;
  caretVisible?: boolean;
  linePrefixFirst?: string;
  linePrefixRest?: string;
  onChange: (next: string) => void;
  onSubmit: (value: string) => void;
  onCursorLine?: (line: number, lineCount: number) => void;
}

type PromptDisplayLine = {
  before: string;
  cursor: string | null;
  after: string;
};

export function moveWordLeft(value: string, cursor: number): number {
  let index = Math.max(0, Math.min(cursor, value.length));
  while (index > 0 && /\s/.test(value[index - 1] ?? "")) {
    index -= 1;
  }
  while (index > 0 && !/\s/.test(value[index - 1] ?? "")) {
    index -= 1;
  }
  return index;
}

export function moveWordRight(value: string, cursor: number): number {
  let index = Math.max(0, Math.min(cursor, value.length));
  while (index < value.length && /\s/.test(value[index] ?? "")) {
    index += 1;
  }
  while (index < value.length && !/\s/.test(value[index] ?? "")) {
    index += 1;
  }
  return index;
}

export function cursorLineIndex(value: string, cursorOffset: number): number {
  const clamped = Math.max(0, Math.min(cursorOffset, value.length));
  return value.slice(0, clamped).split("\n").length - 1;
}

export function moveLineUp(value: string, cursor: number): number {
  const clamped = Math.max(0, Math.min(cursor, value.length));
  const before = value.slice(0, clamped);
  const currentLineStart = before.lastIndexOf("\n") + 1;
  if (currentLineStart === 0) return cursor; // already on first line
  const column = clamped - currentLineStart;
  const prevLineEnd = currentLineStart - 1;
  const prevLineStart = before.lastIndexOf("\n", prevLineEnd - 1) + 1;
  const prevLineLength = prevLineEnd - prevLineStart;
  return prevLineStart + Math.min(column, prevLineLength);
}

export function moveLineDown(value: string, cursor: number): number {
  const clamped = Math.max(0, Math.min(cursor, value.length));
  const before = value.slice(0, clamped);
  const currentLineStart = before.lastIndexOf("\n") + 1;
  const column = clamped - currentLineStart;
  const nextNewline = value.indexOf("\n", clamped);
  if (nextNewline === -1) return cursor; // already on last line
  const nextLineStart = nextNewline + 1;
  const nextNextNewline = value.indexOf("\n", nextLineStart);
  const nextLineLength = (nextNextNewline === -1 ? value.length : nextNextNewline) - nextLineStart;
  return nextLineStart + Math.min(column, nextLineLength);
}

export function buildPromptDisplayLines(value: string, cursorOffset: number): PromptDisplayLine[] {
  const clamped = Math.max(0, Math.min(cursorOffset, value.length));
  const beforeCursor = value.slice(0, clamped);
  const cursorLine = beforeCursor.split("\n").length - 1;
  const lineStart = beforeCursor.lastIndexOf("\n") + 1;
  const cursorColumn = clamped - lineStart;
  const lines = value.split("\n");
  return lines.map((line, index) => {
    if (index !== cursorLine) return { before: line, cursor: null, after: "" };
    if (cursorColumn < line.length) {
      return {
        before: line.slice(0, cursorColumn),
        cursor: line[cursorColumn] ?? " ",
        after: line.slice(cursorColumn + 1),
      };
    }
    return { before: line, cursor: " ", after: "" };
  });
}

export function PromptInput({
  value,
  placeholder = "",
  focus = true,
  caretVisible = true,
  linePrefixFirst = "",
  linePrefixRest = "",
  onChange,
  onSubmit,
  onCursorLine,
}: PromptInputProps): React.JSX.Element {
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
  onCursorLineRef.current = onCursorLine;
  if (valueRef.current !== value) {
    const clamped = Math.max(0, Math.min(cursorRef.current, value.length));
    cursorRef.current = clamped;
    if (cursorOffset !== clamped) setCursorOffset(clamped);
  }
  valueRef.current = value;
  onChangeRef.current = onChange;
  onSubmitRef.current = onSubmit;

  const handleInput = useCallback((input: string, key: Parameters<Parameters<typeof useInput>[0]>[1]) => {
    const emitChange = (next: string) => {
      valueRef.current = next;
      onChangeRef.current(next);
    };
    const moveCursor = (next: number) => {
      cursorRef.current = next;
      setCursorOffset(next);
      const v = valueRef.current;
      const lineCount = v.split("\n").length;
      onCursorLineRef.current?.(cursorLineIndex(v, next), lineCount);
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
        moveCursor(moveWordLeft(v, c));
        return;
      case "move_word_right":
        moveCursor(moveWordRight(v, c));
        return;
      case "delete_word_back": {
        metaPrefixAt.current = null;
        if (c === 0) return;
        const next = moveWordLeft(v, c);
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
        moveCursor(moveLineUp(v, c));
        return;
      case "move_down":
        moveCursor(moveLineDown(v, c));
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
        emitChange(`${v.slice(0, c)}${action.text}${v.slice(c)}`);
        moveCursor(c + action.text.length);
        return;
      default:
        unreachable(action);
    }
  }, []);

  useInput(handleInput, { isActive: focus });

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
    const lines = value.split("\n");
    let lineOffset = 0;
    const readonlyLines = lines.map((line) => {
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
  const lines = buildPromptDisplayLines(value, cursorOffset);
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
