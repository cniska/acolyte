import { Box, Text, useInput } from "ink";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { ESCAPE_CHAR, resolvePromptAction } from "./prompt-keymap";

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
}: PromptInputProps): React.JSX.Element {
  const [cursorOffset, setCursorOffset] = useState(value.length);
  const metaPrefixAt = useRef<number | null>(null);
  const valueRef = useRef(value);
  const cursorRef = useRef(cursorOffset);
  valueRef.current = value;
  cursorRef.current = cursorOffset;

  const emitChange = (next: string) => {
    valueRef.current = next;
    onChange(next);
  };
  const moveCursor = (next: number) => {
    cursorRef.current = next;
    setCursorOffset(next);
  };

  useEffect(() => {
    setCursorOffset((current) => Math.max(0, Math.min(current, value.length)));
  }, [value]);

  useInput(
    (input, key) => {
      const v = valueRef.current;
      const c = cursorRef.current;
      const now = Date.now();
      const hasMetaPrefix = metaPrefixAt.current !== null && now - metaPrefixAt.current <= META_PREFIX_WINDOW_MS;
      if (input === ESCAPE_CHAR && !key.backspace && !key.delete) {
        metaPrefixAt.current = now;
        return;
      }
      if (key.escape && !input) {
        metaPrefixAt.current = now;
        return;
      }

      const action = resolvePromptAction(input, key, { hasMetaPrefix });
      if (action.type === "noop") {
        metaPrefixAt.current = null;
        return;
      }
      if (action.type === "submit") {
        onSubmit(v);
        return;
      }
      if (action.type === "move_home") {
        moveCursor(0);
        return;
      }
      if (action.type === "move_end") {
        moveCursor(v.length);
        return;
      }
      if (action.type === "move_word_left") {
        moveCursor(moveWordLeft(v, c));
        return;
      }
      if (action.type === "move_word_right") {
        moveCursor(moveWordRight(v, c));
        return;
      }
      if (action.type === "delete_word_back") {
        metaPrefixAt.current = null;
        if (c === 0) return;
        const next = moveWordLeft(v, c);
        emitChange(`${v.slice(0, next)}${v.slice(c)}`);
        moveCursor(next);
        return;
      }
      if (action.type === "clear_line") {
        metaPrefixAt.current = null;
        if (v.length === 0) return;
        emitChange("");
        moveCursor(0);
        return;
      }
      if (action.type === "move_left") {
        moveCursor(Math.max(0, c - 1));
        return;
      }
      if (action.type === "move_right") {
        moveCursor(Math.min(v.length, c + 1));
        return;
      }
      if (action.type === "delete_back") {
        metaPrefixAt.current = null;
        if (c === 0) return;
        emitChange(`${v.slice(0, c - 1)}${v.slice(c)}`);
        moveCursor(c - 1);
        return;
      }
      if (action.type === "delete_forward") {
        metaPrefixAt.current = null;
        if (c >= v.length) return;
        emitChange(`${v.slice(0, c)}${v.slice(c + 1)}`);
        return;
      }

      metaPrefixAt.current = null;
      emitChange(`${v.slice(0, c)}${action.text}${v.slice(c)}`);
      moveCursor(c + action.text.length);
    },
    { isActive: focus },
  );

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
