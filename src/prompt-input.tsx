import React, { useEffect, useState } from "react";
import { Text, useInput } from "ink";

const CTRL_C = "c";
const CTRL_W = "w";
const META_B = "b";
const META_F = "f";
const ESC_ALT_B = "\u001bb";
const ESC_ALT_F = "\u001bf";

interface PromptInputProps {
  value: string;
  placeholder?: string;
  focus?: boolean;
  onChange: (next: string) => void;
  onSubmit: (value: string) => void;
}

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

export function PromptInput({
  value,
  placeholder = "",
  focus = true,
  onChange,
  onSubmit,
}: PromptInputProps): React.JSX.Element {
  const [cursorOffset, setCursorOffset] = useState(value.length);

  useEffect(() => {
    setCursorOffset((current) => Math.max(0, Math.min(current, value.length)));
  }, [value]);

  useInput(
    (input, key) => {
      if (
        key.upArrow ||
        key.downArrow ||
        key.tab ||
        (key.shift && key.tab) ||
        (key.ctrl && input === CTRL_C)
      ) {
        return;
      }

      if (key.return) {
        onSubmit(value);
        return;
      }

      if (key.leftArrow && key.meta) {
        setCursorOffset(0);
        return;
      }

      if (key.rightArrow && key.meta) {
        setCursorOffset(value.length);
        return;
      }

      if ((key.leftArrow && key.ctrl) || (key.meta && input === META_B) || input === ESC_ALT_B) {
        setCursorOffset((current) => moveWordLeft(value, current));
        return;
      }

      if ((key.rightArrow && key.ctrl) || (key.meta && input === META_F) || input === ESC_ALT_F) {
        setCursorOffset((current) => moveWordRight(value, current));
        return;
      }

      if (key.ctrl && input === CTRL_W) {
        if (cursorOffset === 0) {
          return;
        }
        const next = moveWordLeft(value, cursorOffset);
        onChange(`${value.slice(0, next)}${value.slice(cursorOffset)}`);
        setCursorOffset(next);
        return;
      }

      if (key.leftArrow) {
        setCursorOffset((current) => Math.max(0, current - 1));
        return;
      }

      if (key.rightArrow) {
        setCursorOffset((current) => Math.min(value.length, current + 1));
        return;
      }

      if (key.backspace) {
        if (cursorOffset === 0) {
          return;
        }
        onChange(`${value.slice(0, cursorOffset - 1)}${value.slice(cursorOffset)}`);
        setCursorOffset((current) => Math.max(0, current - 1));
        return;
      }

      if (key.delete) {
        if (cursorOffset >= value.length) {
          return;
        }
        onChange(`${value.slice(0, cursorOffset)}${value.slice(cursorOffset + 1)}`);
        return;
      }

      // Ignore escape/control sequences so modifier shortcuts don't pollute input.
      if (!input || key.ctrl || key.meta || input.includes("\u001b")) {
        return;
      }

      onChange(`${value.slice(0, cursorOffset)}${input}${value.slice(cursorOffset)}`);
      setCursorOffset((current) => current + input.length);
    },
    { isActive: focus },
  );

  if (value.length === 0 && placeholder.length > 0) {
    return (
      <Text>
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
    return <Text>{value}</Text>;
  }

  const before = value.slice(0, cursorOffset);
  const cursor = cursorOffset < value.length ? value[cursorOffset] : " ";
  const after = cursorOffset < value.length ? value.slice(cursorOffset + 1) : "";

  return (
    <Text>
      {before}
      <Text inverse>{cursor}</Text>
      {after}
    </Text>
  );
}
