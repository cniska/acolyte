import { readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { chatRowSchema } from "../src/chat-contract";
import { migrateLegacyChatRow, transcriptRowSchema } from "../src/chat-transcript-contract";
import { dataDir } from "../src/paths";

const sessionFileSchema = z.object({ sessions: z.array(z.unknown()) }).passthrough();

function migrateSessionTranscript(raw: unknown): { session: unknown; changed: boolean } {
  if (!raw || typeof raw !== "object") return { session: raw, changed: false };
  const session = raw as Record<string, unknown>;
  if (!Array.isArray(session.transcript)) return { session, changed: false };
  if (z.array(transcriptRowSchema).safeParse(session.transcript).success) return { session, changed: false };
  const legacy = z.array(chatRowSchema).safeParse(session.transcript);
  if (!legacy.success) throw new Error("session has an invalid transcript");
  return { session: { ...session, transcript: legacy.data.map(migrateLegacyChatRow) }, changed: true };
}

export async function migrateSemanticTranscripts(path: string): Promise<number> {
  const raw = sessionFileSchema.parse(JSON.parse(await readFile(path, "utf8")));
  let changed = 0;
  const sessions = raw.sessions.map((session) => {
    const migrated = migrateSessionTranscript(session);
    if (migrated.changed) changed += 1;
    return migrated.session;
  });
  if (changed === 0) return 0;
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, JSON.stringify({ ...raw, sessions }, null, 2), "utf8");
  await rename(temporaryPath, path);
  return changed;
}

if (import.meta.main) {
  const path = resolve(process.argv[2] ?? `${dataDir()}/sessions.json`);
  const changed = await migrateSemanticTranscripts(path);
  console.log(
    changed === 0
      ? `No session transcripts needed migration in ${path}`
      : `Migrated ${changed} session transcripts in ${path}`,
  );
}
