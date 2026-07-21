import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileSessionStore, createSession } from "./session-store";

test("file sessions persist semantic transcripts and restore the legacy bridge", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acolyte-semantic-transcript-"));
  const path = join(directory, "sessions.json");
  try {
    const store = createFileSessionStore(path);
    const session = createSession("test");
    session.transcript = [{ id: "row_1", kind: "assistant", content: "hello" }];
    session.transcriptPresentation = [
      { id: "row_1", kind: "assistant", lifecycle: "complete", content: { kind: "message", text: "hello" } },
    ];
    await store.saveSession(session);
    const raw = JSON.parse(await readFile(path, "utf8"));
    expect(raw.sessions[0].transcript).toEqual(session.transcriptPresentation);
    expect(raw.sessions[0].transcriptPresentation).toBeUndefined();
    expect((await store.getSession(session.id))?.transcript).toEqual(session.transcript);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
