export type TuiNodeType = "tui-root" | "tui-box" | "tui-text" | "tui-static" | "tui-virtual";

export interface TuiProps {
  // Box
  flexDirection?: "row" | "column";
  width?: number;
  // Text
  color?: string;
  dimColor?: boolean;
  backgroundColor?: string;
  bold?: boolean;
  underline?: boolean;
  inverse?: boolean;
  // Static
  items?: unknown[];
}

export interface TuiElement {
  kind: "element";
  type: TuiNodeType;
  props: TuiProps;
  children: TuiNode[];
  parent: TuiElement | null;
}

export interface TuiTextNode {
  kind: "text";
  value: string;
  parent: TuiElement | null;
}

export type TuiNode = TuiElement | TuiTextNode;

export function createElement(type: TuiNodeType, props: TuiProps): TuiElement {
  return { kind: "element", type, props, children: [], parent: null };
}

export function createTextNode(value: string): TuiTextNode {
  return { kind: "text", value, parent: null };
}

export function appendChild(parent: TuiElement, child: TuiNode): void {
  child.parent = parent;
  parent.children.push(child);
}

export function removeChild(parent: TuiElement, child: TuiNode): void {
  const index = parent.children.indexOf(child);
  if (index !== -1) {
    parent.children.splice(index, 1);
    child.parent = null;
  }
}

export function insertBefore(parent: TuiElement, child: TuiNode, before: TuiNode): void {
  child.parent = parent;
  const index = parent.children.indexOf(before);
  if (index === -1) {
    parent.children.push(child);
  } else {
    parent.children.splice(index, 0, child);
  }
}
