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

export function stripAnsiLength(value: string): number {
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

/**
 * Serialize a node to string. When `staticAcc` is provided, `tui-static`
 * children are collected into it instead of rendered inline — this lets
 * the render loop flush them once to scrollback and only re-render the
 * active (non-static) portion of the tree.
 */
function serializeNode(node: TuiNode, inherited: StyleStack, staticAcc?: string[]): string {
  if (node.kind === "text") {
    if (node.value.length === 0) return "";
    if (hasStyle(inherited)) {
      return `${openStyle(inherited)}${node.value}${ansi.reset}`;
    }
    return node.value;
  }

  const el = node;

  if (el.type === "tui-virtual") {
    return el.children.map((child) => serializeNode(child, inherited, staticAcc)).join("");
  }

  if (el.type === "tui-text") {
    const style = mergeStyle(inherited, el.props);
    return el.children.map((child) => serializeNode(child, style, staticAcc)).join("");
  }

  if (el.type === "tui-static") {
    if (staticAcc) {
      // Collect each virtual child separately for incremental flushing.
      for (const child of el.children) {
        staticAcc.push(serializeNode(child, inherited));
      }
      return "";
    }
    // No accumulator — render inline (used by serialize / renderToString).
    return el.children.map((child) => serializeNode(child, inherited)).join("\n");
  }

  if (el.type === "tui-box") {
    const style = mergeStyle(inherited, el.props);
    const isColumn = el.props.flexDirection === "column";

    if (isColumn) {
      const parts = el.children.map((child) => serializeNode(child, style, staticAcc)).filter((p) => p.length > 0);
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
    const childOutputs = el.children.map((child) => serializeNode(child, style, staticAcc));
    const boxWidth = el.props.width;
    const justify = el.props.justifyContent;
    const wrap = el.props.flexWrap === "wrap";

    if (wrap && boxWidth !== undefined) {
      const totalWidth = childOutputs.reduce((sum, o) => sum + stripAnsiLength(o.split("\n")[0] ?? ""), 0);
      if (totalWidth > boxWidth) {
        let joined = childOutputs.join("\n");
        joined = joined
          .split("\n")
          .map((line) => padLine(line, boxWidth))
          .join("\n");
        return joined;
      }
    }

    if (justify === "space-between" && boxWidth !== undefined && childOutputs.length >= 2) {
      return joinRowSpaceBetween(childOutputs, boxWidth);
    }

    if (justify === "flex-end" && boxWidth !== undefined) {
      const content = childOutputs.join("");
      const visible = stripAnsiLength(content);
      if (visible < boxWidth) return " ".repeat(boxWidth - visible) + content;
      return content;
    }

    return joinRow(childOutputs, boxWidth);
  }

  // Root — render children as column
  return el.children
    .map((child) => serializeNode(child, inherited, staticAcc))
    .filter((p) => p.length > 0)
    .join("\n");
}

/** Join children with space distributed evenly between them. */
function joinRowSpaceBetween(childOutputs: string[], boxWidth: number): string {
  const visibleWidths = childOutputs.map((o) => stripAnsiLength(o.split("\n")[0] ?? ""));
  const totalContent = visibleWidths.reduce((a, b) => a + b, 0);
  const totalGap = Math.max(0, boxWidth - totalContent);
  const gaps = childOutputs.length - 1;

  if (gaps <= 0) {
    return padLine(childOutputs[0] ?? "", boxWidth);
  }

  const baseGap = Math.floor(totalGap / gaps);
  let extraGaps = totalGap - baseGap * gaps;
  let result = "";
  for (let i = 0; i < childOutputs.length; i++) {
    result += childOutputs[i];
    if (i < childOutputs.length - 1) {
      const extra = extraGaps > 0 ? 1 : 0;
      extraGaps -= extra;
      result += " ".repeat(baseGap + extra);
    }
  }
  return result;
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

/**
 * Split root into static (write-once scrollback) and active (re-rendered) regions.
 * Walks the full tree — `tui-static` elements at any depth are collected into
 * `staticItems` instead of rendered inline, so the render loop can flush them
 * once to scrollback and only re-draw the active portion each frame.
 */
export function serializeSplit(root: TuiElement): { staticItems: string[]; active: string } {
  const emptyStyle: StyleStack = {};
  const staticItems: string[] = [];
  const active = serializeNode(root, emptyStyle, staticItems);
  return { staticItems, active };
}
