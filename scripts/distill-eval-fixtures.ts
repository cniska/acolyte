import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { createDistillInput } from "../src/memory-distiller";
import { taskActivitySchema } from "../src/task-activity";
import { parseClaudeCodeTranscript } from "../src/transcript-claude-code";

/**
 * One turn frozen as the distiller sees it. The messages are already windowed the way `commit`
 * slices them, so a fixture replays a single distill call with nothing left to resolve at run time.
 */
export const distillFixtureSchema = z.object({
  id: z.string().trim().min(1),
  provenance: z.object({
    source: z.literal("claude-code"),
    sessionId: z.string(),
    turnIndex: z.number().int().nonnegative(),
    capturedAt: z.string(),
    note: z.string().optional(),
  }),
  messages: z.array(z.object({ role: z.string(), content: z.string() })).min(1),
  output: z.string(),
  activity: taskActivitySchema.optional(),
  /** Facts a good distillation carries, each graded by the judge against any wording. */
  expected: z.array(z.object({ fact: z.string().trim().min(1), scope: z.enum(["project", "user"]) })).default([]),
  /** Regex literals a recorded fact may never match, each one a failure the corpus measured. */
  mustNot: z.array(z.string()).default([]),
  /**
   * A fact the corpus actually recorded wrong from this turn, kept verbatim so the checks can be
   * replayed against it. A fixture carrying one is a fixture whose labels are known to be able to
   * fire; the eval refuses to run when a recorded corruption no longer trips anything.
   */
  measuredFailure: z.string().optional(),
});

export type DistillFixture = z.infer<typeof distillFixtureSchema>;

export const FIXTURE_DIR = join(import.meta.dir, "data", "distill-eval");

/** The text a recorded fact's specifics must be quotable from: exactly what the model was shown. */
export function fixtureTurnText(fixture: DistillFixture): string {
  return createDistillInput(fixture.messages, fixture.output, fixture.activity);
}

export async function loadFixtures(dir: string = FIXTURE_DIR): Promise<DistillFixture[]> {
  const names = (await readdir(dir)).filter((name) => name.endsWith(".json")).sort();
  const fixtures: DistillFixture[] = [];
  for (const name of names) {
    const raw = JSON.parse(await readFile(join(dir, name), "utf8"));
    fixtures.push(distillFixtureSchema.parse(raw));
  }
  return fixtures;
}

export async function writeFixture(fixture: DistillFixture, dir: string = FIXTURE_DIR): Promise<string> {
  const path = join(dir, `${fixture.id}.json`);
  await writeFile(path, `${JSON.stringify(fixture, null, 2)}\n`);
  return path;
}

export type CaptureRequest = {
  transcriptPath: string;
  turnIndex: number;
  id: string;
  contextMessageWindow: number;
  note?: string;
};

/**
 * Extracts one turn through the same parser an import uses, so a fixture cannot encode a shape the
 * real pipeline never produces. The result is written for a human to redact and label before it is
 * committed — capture never invents `expected` or `mustNot`.
 */
export async function captureFixture(request: CaptureRequest): Promise<DistillFixture> {
  const transcript = parseClaudeCodeTranscript(await readFile(request.transcriptPath, "utf8"));
  const exchange = transcript.exchanges[request.turnIndex];
  if (!exchange) {
    throw new Error(`turn ${request.turnIndex} is past the session's ${transcript.exchanges.length} exchanges`);
  }

  const messages: { role: string; content: string }[] = [];
  for (const prior of transcript.exchanges.slice(0, request.turnIndex)) {
    messages.push({ role: "user", content: prior.prompt });
    messages.push({ role: "assistant", content: prior.response });
  }
  messages.push({ role: "user", content: exchange.prompt });

  return distillFixtureSchema.parse({
    id: request.id,
    provenance: {
      source: "claude-code",
      sessionId: transcript.sessionId ?? "unknown",
      turnIndex: request.turnIndex,
      capturedAt: new Date().toISOString(),
      ...(request.note ? { note: request.note } : {}),
    },
    messages: messages.slice(-request.contextMessageWindow),
    output: exchange.response,
    activity: exchange.activity,
    expected: [],
    mustNot: [],
  });
}

/** Turns in a session whose text matches a pattern, so a known failure's turn can be found again. */
export async function findTurns(transcriptPath: string, pattern: RegExp): Promise<{ index: number; prompt: string }[]> {
  const transcript = parseClaudeCodeTranscript(await readFile(transcriptPath, "utf8"));
  return transcript.exchanges
    .map((exchange, index) => ({ index, prompt: exchange.prompt, response: exchange.response }))
    .filter((turn) => pattern.test(turn.prompt) || pattern.test(turn.response))
    .map(({ index, prompt }) => ({ index, prompt: prompt.slice(0, 160) }));
}
