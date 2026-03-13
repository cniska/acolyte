import type React from "react";
import { createElement } from "react";

type BoxProps = {
  flexDirection?: "row" | "column";
  width?: number;
  children?: React.ReactNode;
  key?: React.Key;
};

type TextProps = {
  color?: string;
  dimColor?: boolean;
  backgroundColor?: string;
  bold?: boolean;
  underline?: boolean;
  inverse?: boolean;
  children?: React.ReactNode;
  key?: React.Key;
};

type StaticProps<T> = {
  items: T[];
  children: (item: T, index: number) => React.ReactNode;
};

export function Box(props: BoxProps): React.ReactElement {
  return createElement("tui-box", props as Record<string, unknown>, props.children);
}

export function Text(props: TextProps): React.ReactElement {
  return createElement("tui-text", props as Record<string, unknown>, props.children);
}

export function Static<T extends { id?: string }>(props: StaticProps<T>): React.ReactElement {
  const children = props.items.map((item, index) => props.children(item, index));
  return createElement("tui-static", { internal_static: true } as Record<string, unknown>, ...children);
}
