import { describe, expect, test } from "bun:test";
import { appendChild, createElement, createTextNode, insertBefore, removeChild } from "./dom";

describe("dom", () => {
  test("createElement creates element with empty children", () => {
    const el = createElement("tui-box", { bold: true });
    expect(el.kind).toBe("element");
    expect(el.type).toBe("tui-box");
    expect(el.props.bold).toBe(true);
    expect(el.children).toEqual([]);
    expect(el.parent).toBeNull();
  });

  test("createTextNode creates text node", () => {
    const node = createTextNode("hello");
    expect(node.kind).toBe("text");
    expect(node.value).toBe("hello");
    expect(node.parent).toBeNull();
  });

  test("appendChild adds child and sets parent", () => {
    const parent = createElement("tui-box", {});
    const child = createTextNode("hi");
    appendChild(parent, child);
    expect(parent.children).toEqual([child]);
    expect(child.parent).toBe(parent);
  });

  test("removeChild removes child and clears parent", () => {
    const parent = createElement("tui-box", {});
    const child = createTextNode("hi");
    appendChild(parent, child);
    removeChild(parent, child);
    expect(parent.children).toEqual([]);
    expect(child.parent).toBeNull();
  });

  test("removeChild does nothing for non-child node", () => {
    const parent = createElement("tui-box", {});
    const other = createTextNode("other");
    other.parent = createElement("tui-text", {});
    removeChild(parent, other);
    // parent pointer should not be cleared since it wasn't a child
    expect(other.parent).not.toBeNull();
  });

  test("insertBefore inserts child before reference node", () => {
    const parent = createElement("tui-box", {});
    const a = createTextNode("a");
    const b = createTextNode("b");
    appendChild(parent, b);
    insertBefore(parent, a, b);
    expect(parent.children).toEqual([a, b]);
    expect(a.parent).toBe(parent);
  });

  test("insertBefore appends when reference not found", () => {
    const parent = createElement("tui-box", {});
    const a = createTextNode("a");
    const b = createTextNode("b");
    appendChild(parent, a);
    insertBefore(parent, b, createTextNode("missing"));
    expect(parent.children).toEqual([a, b]);
    expect(b.parent).toBe(parent);
  });
});
