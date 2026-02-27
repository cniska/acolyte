import { Box, Text, useInput } from "ink";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { resolvePromptAction } from "./prompt-keymap";

const META_PREFIX_WINDOW_MS = 150;
const ESCAPE_CHAR = "\u001b";

interface PromptInputProps {
  value: string;
  placeholder?: string;
  focus?: boolean;
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
  linePrefixFirst = "",
  linePrefixRest = "",
  onChange,
  onSubmit,
}: PromptInputProps): React.JSX.Element {
  const [cursorOffset, setCursorOffset] = useState(value.length);
  const metaPrefixAt = useRef<number | null>(null);

  useEffect(() => {
    setCursorOffset((current) => Math.max(0, Math.min(current, value.length)));
  }, [value]);

  useInput(
    (input, key) => {
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
        onSubmit(value);
        return;
      }
      if (action.type === "move_home") {
        setCursorOffset(0);
        return;
      }
      if (action.type === "move_end") {
        setCursorOffset(value.length);
        return;
      }
      if (action.type === "move_word_left") {
        setCursorOffset((current) => moveWordLeft(value, current));
        return;
      }
      if (action.type === "move_word_right") {
        setCursorOffset((current) => moveWordRight(value, current));
        return;
      }
      if (action.type === "delete_word_back") {
        metaPrefixAt.current = null;
        if (cursorOffset === 0) return;
        const next = moveWordLeft(value, cursorOffset);
        onChange(`${value.slice(0, next)}${value.slice(cursorOffset)}`);
        setCursorOffset(next);
        return;
      }
      if (action.type === "clear_line") {
        metaPrefixAt.current = null;
        if (value.length === 0) return;
        onChange("");
        setCursorOffset(0);
        return;
      }
      if (action.type === "move_left") {
        setCursorOffset((current) => Math.max(0, current - 1));
        return;
      }
      if (action.type === "move_right") {
        setCursorOffset((current) => Math.min(value.length, current + 1));
        return;
      }
      if (action.type === "delete_back") {
        metaPrefixAt.current = null;
        if (cursorOffset === 0) return;
        onChange(`${value.slice(0, cursorOffset - 1)}${value.slice(cursorOffset)}`);
        setCursorOffset((current) => Math.max(0, current - 1));
        return;
      }
      if (action.type === "delete_forward") {
        metaPrefixAt.current = null;
        if (cursorOffset >= value.length) return;
        onChange(`${value.slice(0, cursorOffset)}${value.slice(cursorOffset + 1)}`);
        return;
      }

      metaPrefixAt.current = null;
      onChange(`${value.slice(0, cursorOffset)}${action.text}${value.slice(cursorOffset)}`);
      setCursorOffset((current) => current + action.text.length);
    },
    { isActive: focus },
  );

  if (value.length === 0 && placeholder.length > 0) {
    return (
      <Text>
        {linePrefixFirst}
        {focus ? (
          <>
            <Text inverse>{placeholder[0] ?? " "}</Text>
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
          {entry.line.cursor !== null ? <Text inverse>{entry.line.cursor}</Text> : null}
          {entry.line.after}
        </Text>
      ))}
    </Box>
  );
}
