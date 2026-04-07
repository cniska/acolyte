import { afterEach, describe, expect, test } from "bun:test";
import type { Session } from "./session-contract";
import type { SessionStore } from "./session-contract";

function makeSession(overrides: Partial<Session> & { id: string }): Session {
  return {
    createdAt: "2026-03-04T12:00:00.000Z",
    updatedAt: "2026-03-04T12:00:00.000Z",
    model: "gpt-5-mini",
    title: "Test Session",
    messages: [],
    tokenUsage: [],
    ...overrides,
  };
}

export function sessionStoreContractTests(
  name: string,
  setup: { create: () => SessionStore | Promise<SessionStore>; cleanup: () => void | Promise<void> },
) {
  let store: SessionStore;

  afterEach(async () => {
    await setup.cleanup();
  });

  async function getStore(): Promise<SessionStore> {
    store = await setup.create();
    return store;
  }

  describe(`${name} SessionStore contract`, () => {
    test("listSessions returns empty array initially", async () => {
      const s = await getStore();
      const sessions = await s.listSessions();
      expect(sessions).toEqual([]);
    });

    test("saveSession + getSession round-trips", async () => {
      const s = await getStore();
      const session = makeSession({ id: "sess_test001", title: "My Session" });
      await s.saveSession(session);
      const retrieved = await s.getSession("sess_test001");
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe("sess_test001");
      expect(retrieved?.title).toBe("My Session");
      expect(retrieved?.messages).toEqual([]);
    });

    test("listSessions returns sessions sorted by updatedAt descending", async () => {
      const s = await getStore();
      const older = makeSession({ id: "sess_older01", updatedAt: "2026-03-04T10:00:00.000Z" });
      const newer = makeSession({ id: "sess_newer01", updatedAt: "2026-03-04T11:00:00.000Z" });
      await s.saveSession(older);
      await s.saveSession(newer);
      const sessions = await s.listSessions();
      expect(sessions[0]?.id).toBe("sess_newer01");
      expect(sessions[1]?.id).toBe("sess_older01");
    });

    test("listSessions respects limit", async () => {
      const s = await getStore();
      for (let i = 0; i < 5; i++) {
        await s.saveSession(makeSession({ id: `sess_lim${i}`, updatedAt: `2026-03-04T1${i}:00:00.000Z` }));
      }
      const sessions = await s.listSessions({ limit: 2 });
      expect(sessions).toHaveLength(2);
    });

    test("saveSession upserts existing session", async () => {
      const s = await getStore();
      const session = makeSession({ id: "sess_upsert1", title: "Original" });
      await s.saveSession(session);
      await s.saveSession({ ...session, title: "Updated" });
      const retrieved = await s.getSession("sess_upsert1");
      expect(retrieved?.title).toBe("Updated");
      const all = await s.listSessions();
      expect(all).toHaveLength(1);
    });

    test("saveSession persists messages as JSONB", async () => {
      const s = await getStore();
      const session = makeSession({
        id: "sess_msgs001",
        messages: [
          { id: "msg_1", role: "user", content: "hello", timestamp: "2026-03-04T12:00:00.000Z", kind: "text" },
          {
            id: "msg_2",
            role: "assistant",
            content: "hi there",
            timestamp: "2026-03-04T12:00:01.000Z",
            kind: "text",
          },
        ] as Session["messages"],
      });
      await s.saveSession(session);
      const retrieved = await s.getSession("sess_msgs001");
      expect(retrieved?.messages).toHaveLength(2);
      expect(retrieved?.messages[0]?.content).toBe("hello");
      expect(retrieved?.messages[1]?.content).toBe("hi there");
    });

    test("removeSession deletes a session", async () => {
      const s = await getStore();
      await s.saveSession(makeSession({ id: "sess_rm00001" }));
      expect(await s.getSession("sess_rm00001")).not.toBeNull();
      await s.removeSession("sess_rm00001");
      expect(await s.getSession("sess_rm00001")).toBeNull();
    });

    test("removeSession is a no-op for nonexistent ID", async () => {
      const s = await getStore();
      await s.removeSession("sess_missing1");
      expect(await s.listSessions()).toEqual([]);
    });

    test("getSession returns null for nonexistent ID", async () => {
      const s = await getStore();
      expect(await s.getSession("sess_missing1")).toBeNull();
    });
  });

  describe(`${name} active session`, () => {
    test("getActiveSessionId returns undefined initially", async () => {
      const s = await getStore();
      expect(await s.getActiveSessionId()).toBeUndefined();
    });

    test("setActiveSessionId + getActiveSessionId round-trips", async () => {
      const s = await getStore();
      await s.saveSession(makeSession({ id: "sess_active1" }));
      await s.setActiveSessionId("sess_active1");
      expect(await s.getActiveSessionId()).toBe("sess_active1");
    });

    test("setActiveSessionId with undefined clears active session", async () => {
      const s = await getStore();
      await s.saveSession(makeSession({ id: "sess_clear01" }));
      await s.setActiveSessionId("sess_clear01");
      expect(await s.getActiveSessionId()).toBe("sess_clear01");
      await s.setActiveSessionId(undefined);
      expect(await s.getActiveSessionId()).toBeUndefined();
    });
  });
}
