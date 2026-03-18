import { describe, expect, test } from "bun:test";
import { createElement as reactCreateElement, useEffect, useState } from "react";
import { useSyncEffect } from "./tui/effects";
import { createElement } from "./tui/dom";
import { setOnCommit } from "./tui/host-config";
import { reconciler } from "./tui/reconciler";
import { serialize } from "./tui/serialize";

function renderTest(component: () => React.ReactElement) {
  const commits: string[] = [];
  const root = createElement("tui-root", {});
  setOnCommit(() => commits.push(serialize(root)));

  const container = reconciler.createContainer(
    root, 0, null, false, null, "",
    (e: Error) => { throw e; },
    () => {}, () => {}, () => {},
  );
  reconciler.updateContainerSync(reactCreateElement(component), container, null, null);
  reconciler.flushSyncWork();
  reconciler.flushPassiveEffects();

  return {
    commits,
    flush() {
      reconciler.flushSyncWork();
      reconciler.flushPassiveEffects();
    },
    unmount() {
      reconciler.updateContainerSync(null, container, null, null);
      reconciler.flushSyncWork();
      setOnCommit(null);
    },
  };
}

function wait(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("streaming renders", () => {
  test("external setState triggers new commits", async () => {
    let setRows: ((fn: (prev: string[]) => string[]) => void) | null = null;

    function App() {
      const [rows, _setRows] = useState<string[]>([]);
      setRows = _setRows;
      return reactCreateElement("tui-box", { flexDirection: "column" },
        ...rows.map((row, i) => reactCreateElement("tui-text", { key: i }, row)),
      );
    }

    const { commits, unmount } = renderTest(App);
    const initial = commits.length;

    setRows!((prev) => [...prev, "token 1"]);
    await wait();

    setRows!((prev) => [...prev, "token 2"]);
    await wait();

    expect(commits.length).toBeGreaterThan(initial);

    const last = commits[commits.length - 1]!;
    expect(last).toContain("token 1");
    expect(last).toContain("token 2");

    unmount();
  });

  test("useSyncEffect firing every render does not block streaming", async () => {
    let setRows: ((fn: (prev: string[]) => string[]) => void) | null = null;

    function App() {
      const [rows, _setRows] = useState<string[]>([]);
      setRows = _setRows;

      // Simulate suggestSlashCommands: new array every render
      const derived = rows.map((r) => r.toUpperCase());
      const [clampedIndex, setClampedIndex] = useState(0);

      // This fires every render because derived is new each time
      useSyncEffect(() => {
        setClampedIndex((c) => Math.min(c, Math.max(0, derived.length - 1)));
      }, [derived]);

      return reactCreateElement("tui-box", { flexDirection: "column" },
        reactCreateElement("tui-text", null, `idx:${clampedIndex}`),
        ...rows.map((row, i) => reactCreateElement("tui-text", { key: i }, row)),
      );
    }

    const { commits, unmount } = renderTest(App);
    const initial = commits.length;

    setRows!((prev) => [...prev, "token 1"]);
    await wait();
    const afterFirst = commits.length;
    expect(afterFirst).toBeGreaterThan(initial);

    setRows!((prev) => [...prev, "token 2"]);
    await wait();
    const afterSecond = commits.length;
    expect(afterSecond).toBeGreaterThan(afterFirst);

    setRows!((prev) => [...prev, "token 3"]);
    await wait();

    // Each token should have produced incremental commits
    const tokenCommits = commits.slice(initial);
    const hasToken1Only = tokenCommits.some((s) => s.includes("token 1") && !s.includes("token 2"));
    const hasToken2 = tokenCommits.some((s) => s.includes("token 2"));
    const hasToken3 = tokenCommits.some((s) => s.includes("token 3"));
    expect(hasToken1Only).toBe(true);
    expect(hasToken2).toBe(true);
    expect(hasToken3).toBe(true);

    unmount();
  });

  test("multiple useSyncEffects matching chat-state pattern do not block streaming", async () => {
    let setRows: ((fn: (prev: string[]) => string[]) => void) | null = null;
    let setPending: ((v: boolean) => void) | null = null;

    function App() {
      const [rows, _setRows] = useState<string[]>([]);
      const [pending, _setPending] = useState(false);
      setRows = _setRows;
      setPending = _setPending;

      // Effect 1: isPending transition
      const [startedAt, setStartedAt] = useState<number | null>(null);
      useSyncEffect(() => {
        if (pending) setStartedAt((c) => c ?? Date.now());
        else setStartedAt(null);
      }, [pending]);

      // Effect 2: derived array (new ref each render)
      const suggestions = rows.map((r) => r.slice(0, 1));
      const [idx, setIdx] = useState(0);
      useSyncEffect(() => {
        setIdx((c) => Math.min(c, Math.max(0, suggestions.length - 1)));
      }, [suggestions]);

      return reactCreateElement("tui-box", { flexDirection: "column" },
        reactCreateElement("tui-text", null, `pending:${pending} started:${startedAt !== null} idx:${idx}`),
        ...rows.map((row, i) => reactCreateElement("tui-text", { key: i }, row)),
      );
    }

    const { commits, unmount } = renderTest(App);

    // Start "pending" (like submitting a message)
    setPending!(true);
    await wait();

    const beforeStreaming = commits.length;

    // Stream tokens while pending
    setRows!((prev) => [...prev, "chunk 1"]);
    await wait();
    setRows!((prev) => [...prev, "chunk 2"]);
    await wait();
    setRows!((prev) => [...prev, "chunk 3"]);
    await wait();

    const streamingCommits = commits.slice(beforeStreaming);
    expect(streamingCommits.length).toBeGreaterThanOrEqual(3);

    // Verify incremental content
    const hasChunk1Only = streamingCommits.some((s) => s.includes("chunk 1") && !s.includes("chunk 2"));
    const hasChunk3 = streamingCommits.some((s) => s.includes("chunk 3"));
    expect(hasChunk1Only).toBe(true);
    expect(hasChunk3).toBe(true);

    unmount();
  });

  test("setTimeout-based flush (real streaming pattern) produces incremental commits", async () => {
    let setRows: ((fn: (prev: string[]) => string[]) => void) | null = null;
    let setPending: ((v: boolean) => void) | null = null;

    function App() {
      const [rows, _setRows] = useState<string[]>([]);
      const [pending, _setPending] = useState(false);
      const [startedAt, setStartedAt] = useState<number | null>(null);
      setRows = _setRows;
      setPending = _setPending;

      useSyncEffect(() => {
        if (pending) setStartedAt((c) => c ?? Date.now());
        else setStartedAt(null);
      }, [pending]);

      const suggestions = rows.map((r) => r.slice(0, 1));
      const [idx, setIdx] = useState(0);
      useSyncEffect(() => {
        setIdx((c) => Math.min(c, Math.max(0, suggestions.length - 1)));
      }, [suggestions]);

      return reactCreateElement("tui-box", { flexDirection: "column" },
        reactCreateElement("tui-text", null, `p:${pending} s:${startedAt !== null} i:${idx}`),
        ...rows.map((row, i) => reactCreateElement("tui-text", { key: i }, row)),
      );
    }

    const { commits, unmount } = renderTest(App);

    setPending!(true);
    await wait();
    const beforeStream = commits.length;

    // Simulate real streaming: setTimeout-based flush at 50ms intervals
    let content = "";
    const flushToRows = () => {
      const snapshot = content;
      setRows!(() => [snapshot]);
    };

    content = "Hello";
    setTimeout(flushToRows, 50);
    await wait(100);

    content = "Hello world";
    setTimeout(flushToRows, 50);
    await wait(100);

    content = "Hello world!";
    setTimeout(flushToRows, 50);
    await wait(100);

    const streamCommits = commits.slice(beforeStream);
    const hasHelloOnly = streamCommits.some((s) => s.includes("Hello") && !s.includes("world"));
    const hasFinal = streamCommits.some((s) => s.includes("Hello world!"));

    expect(hasHelloOnly).toBe(true);
    expect(hasFinal).toBe(true);

    unmount();
  });
});
