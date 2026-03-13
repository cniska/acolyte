import type { TuiElement, TuiNode, TuiProps } from "./dom";
import { ansi, colorToBg, colorToFg } from "./styles";

interface StyleStack {
  color?: string;
  dimColor?: boolean;
  backgroundColor?: string;
  bold?: boolean;
  underline?: boolean;
  inverse?: boolean;
}

function openStyle(style: StyleStack): string {
  let out = "";
  if (style.bold) out += ansi.bold;
  if (style.dimColor) out += ansi.dim;
  if (style.underline) out += ansi.underline;
  if (style.inverse) out += ansi.inverse;
  if (style.color) out += colorToFg(style.color);
  if (style.backgroundColor) out += colorToBg(style.backgroundColor);
  return out;
}

function hasStyle(style: StyleStack): boolean {
  return !!(style.color || style.dimColor || style.backgroundColor || style.bold || style.underline || style.inverse);
}

function mergeStyle(parent: StyleStack, props: TuiProps): StyleStack {
  return {
    color: props.color ?? parent.color,
    dimColor: props.dimColor ?? parent.dimColor,
    backgroundColor: props.backgroundColor ?? parent.backgroundColor,
    bold: props.bold ?? parent.bold,
    underline: props.underline ?? parent.underline,
    inverse: props.inverse ?? parent.inverse,
  };
}

function serializeNode(node: TuiNode, inherited: StyleStack): string {
  if (node.kind === "text") {
    if (node.value.length === 0) return "";
    if (hasStyle(inherited)) {
      return `${openStyle(inherited)}${node.value}${ansi.reset}`;
    }
    return node.value;
  }

  const el = node as TuiElement;

  if (el.type === "tui-virtual") {
    return el.children.map((child) => serializeNode(child, inherited)).join("");
  }

  if (el.type === "tui-text") {
    const style = mergeStyle(inherited, el.props);
    const content = el.children.map((child) => serializeNode(child, style)).join("");
    return content;
  }

  if (el.type === "tui-box") {
    const style = mergeStyle(inherited, el.props);
    const isColumn = el.props.flexDirection === "column";
    const parts = el.children.map((child) => serializeNode(child, style));
    let joined = isColumn ? parts.join("\n") : parts.join("");

    if (el.props.width !== undefined) {
      const width = el.props.width;
      const lines = joined.split("\n");
      joined = lines
        .map((line) => {
          const visible = stripAnsiLength(line);
          if (visible < width) return line + " ".repeat(width - visible);
          return line;
        })
        .join("\n");
    }
    return joined;
  }

  // Root or static — just render children as column
  return el.children.map((child) => serializeNode(child, inherited)).join("\n");
}

function stripAnsiLength(value: string): number {
  let length = 0;
  let inEscape = false;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "\x1b") {
      inEscape = true;
      continue;
    }
    if (inEscape) {
      if (value[i] === "m") inEscape = false;
      continue;
    }
    length++;
  }
  return length;
}

export function serialize(root: TuiElement, _columns?: number): string {
  const emptyStyle: StyleStack = {};
  return serializeNode(root, emptyStyle);
}
