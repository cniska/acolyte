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

function stripAnsiLength(value: string): number {
  let length = 0;
  let i = 0;
  while (i < value.length) {
    if (value[i] === "\x1b") {
      i++;
      if (i < value.length && value[i] === "[") {
        i++;
        while (i < value.length) {
          const code = value.charCodeAt(i);
          i++;
          if (code >= 0x40 && code <= 0x7e) break;
        }
      } else if (i < value.length) {
        i++;
      }
      continue;
    }
    length++;
    i++;
  }
  return length;
}

function padLine(line: string, width: number): string {
  const visible = stripAnsiLength(line);
  if (visible < width) return line + " ".repeat(width - visible);
  return line;
}

function serializeNode(node: TuiNode, inherited: StyleStack): string {
  if (node.kind === "text") {
    if (node.value.length === 0) return "";
    if (hasStyle(inherited)) {
      return `${openStyle(inherited)}${node.value}${ansi.reset}`;
    }
    return node.value;
  }

  const el = node;

  if (el.type === "tui-virtual") {
    return el.children.map((child) => serializeNode(child, inherited)).join("");
  }

  if (el.type === "tui-text") {
    const style = mergeStyle(inherited, el.props);
    return el.children.map((child) => serializeNode(child, style)).join("");
  }

  if (el.type === "tui-box") {
    const style = mergeStyle(inherited, el.props);
    const isColumn = el.props.flexDirection === "column";

    if (isColumn) {
      const parts = el.children.map((child) => serializeNode(child, style));
      let joined = parts.join("\n");
      if (el.props.width !== undefined) {
        const w = el.props.width;
        joined = joined
          .split("\n")
          .map((line) => padLine(line, w))
          .join("\n");
      }
      return joined;
    }

    // Row direction: concatenate children horizontally.
    // For multiline children, subsequent lines must be padded to align
    // with the child's horizontal start position.
    const childOutputs = el.children.map((child) => serializeNode(child, style));
    return joinRow(childOutputs, el.props.width);
  }

  // Root or static — render children as column
  return el.children.map((child) => serializeNode(child, inherited)).join("\n");
}

/** Join child outputs horizontally, handling multiline content. */
function joinRow(childOutputs: string[], boxWidth?: number): string {
  // Determine which children have multiline content
  const childLines = childOutputs.map((output) => output.split("\n"));
  const maxLines = Math.max(1, ...childLines.map((lines) => lines.length));

  if (maxLines === 1) {
    let result = childOutputs.join("");
    if (boxWidth !== undefined) {
      result = padLine(result, boxWidth);
    }
    return result;
  }

  // Compute the max visible width for each child across all its lines.
  const childWidths = childLines.map((lines) => Math.max(0, ...lines.map((line) => stripAnsiLength(line))));

  const resultLines: string[] = [];
  for (let lineIdx = 0; lineIdx < maxLines; lineIdx++) {
    let row = "";
    for (let childIdx = 0; childIdx < childLines.length; childIdx++) {
      const lines = childLines[childIdx] ?? [];
      const line = lines[lineIdx] ?? "";

      if (childIdx === childLines.length - 1) {
        row += line;
      } else {
        row += padLine(line, childWidths[childIdx] ?? 0);
      }
    }
    resultLines.push(row);
  }

  let result = resultLines.join("\n");
  if (boxWidth !== undefined) {
    result = result
      .split("\n")
      .map((line) => padLine(line, boxWidth))
      .join("\n");
  }
  return result;
}

export function serialize(root: TuiElement): string {
  const emptyStyle: StyleStack = {};
  return serializeNode(root, emptyStyle);
}
