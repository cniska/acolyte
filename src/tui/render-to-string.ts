import type { ReactNode } from "react";
import { createElement } from "./dom";
import { reconciler } from "./reconciler";
import { serialize } from "./serialize";

export function renderToString(node: ReactNode, options?: { columns?: number }): string {
  const root = createElement("tui-root", {});
  const container = reconciler.createContainer(
    root, 0, null, false, null, "",
    (error: Error) => { throw error; },
    () => {},
    () => {},
    () => {},
  );
  reconciler.updateContainer(node, container, null, () => {});
  reconciler.flushSync(() => {});
  return serialize(root, options?.columns);
}
