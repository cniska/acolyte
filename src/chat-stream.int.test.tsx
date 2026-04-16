import { describe, expect, test } from "bun:test";
import { createElement as reactCreateElement, useState } from "react";
import { createElement } from "./tui/dom";
import { setOnCommit } from "./tui/host-config";
import { reconciler } from "./tui/reconciler";
import { serialize } from "./tui/serialize";
import { wait } from "./tui/test-utils";

describe("streaming renders", () => {
  test("unconditional setState during render causes render loop", () => {
    const errors: string[] = [];

    function BrokenApp() {
      const [counter, setCounter] = useState(0);
      setCounter(counter + 1);
      return reactCreateElement("tui-text", null, `${counter}`);
    }

    const root = createElement("tui-root", {});
    const container = reconciler.createContainer(
      root,
      0,
      null,
      false,
      null,
      "",
      (e: Error) => {
        errors.push(e.message);
      },
      () => {},
      () => {},
      () => {},
    );
    reconciler.updateContainerSync(reactCreateElement(BrokenApp), container, null, null);
    reconciler.flushSyncWork();

    expect(errors.some((e) => e.includes("Too many re-renders"))).toBe(true);
  });

  test("external setState produces incremental commits", async () => {
    type Ref<T> = { current: T };
    const ref: Ref<(fn: (prev: string[]) => string[]) => void> = { current: () => {} };
    const commits: string[] = [];
    const root = createElement("tui-root", {});
    setOnCommit(() => commits.push(serialize(root)));

    function App() {
      const [rows, setRows] = useState<string[]>([]);
      ref.current = setRows;
      return reactCreateElement(
        "tui-box",
        { flexDirection: "column" },
        ...rows.map((row, i) => reactCreateElement("tui-text", { key: i }, row)),
      );
    }

    const container = reconciler.createContainer(
      root,
      0,
      null,
      false,
      null,
      "",
      (e: Error) => {
        throw e;
      },
      () => {},
      () => {},
      () => {},
    );
    reconciler.updateContainerSync(reactCreateElement(App), container, null, null);
    reconciler.flushSyncWork();
    reconciler.flushPassiveEffects();
    const initial = commits.length;

    ref.current((prev) => [...prev, "token 1"]);
    await wait();
    ref.current((prev) => [...prev, "token 2"]);
    await wait();

    expect(commits.length).toBeGreaterThan(initial);
    const last = commits.at(-1) ?? "";
    expect(last).toContain("token 1");
    expect(last).toContain("token 2");

    reconciler.updateContainerSync(null, container, null, null);
    reconciler.flushSyncWork();
    setOnCommit(null);
  });
});
