import { z } from "zod";
import { createModel } from "../src/model-factory";
import { normalizeModel, providerFromModel } from "../src/provider-config";
import { sharedRateLimiter } from "../src/rate-limiter";

/**
 * The two gradings a regex cannot carry: which class a recorded fact falls into, and whether a fact
 * the fixture expected was stated in any wording. The judge never sees the prompt under test, which
 * revision produced the fact, or the other revision's output, so a classification cannot be
 * influenced by what is being compared.
 */
export const factClassSchema = z.enum(["state", "narration", "plan", "conversation", "perishable", "recoverable"]);
export type FactClass = z.infer<typeof factClassSchema>;

const CLASS_RUBRIC = `Classify one recorded memory into exactly one class.

state — a claim about how the codebase, the project, or a person now is. Present tense, and it stays true until someone changes the thing itself. A claim only reaches this class if it would still be worth knowing to someone who never saw the turn that produced it.
narration — the subject is an act rather than a state: a commit, an edit, a reset, a command that ran, work that was done. Grammar does not settle this. "The handoff is saved at that path and copied to the clipboard" and "the design was written to that file" are narration in the present tense: what they record is the turn's own act, and the artifact's existence is not a fact about the project.
plan — an intention to do work, in any tense: "should be removed", "will add", "needs to", "Plan:", or a task someone is about to carry out. A decision that has already been reached is not a plan even when nothing implements it yet, so "imports spend oldest-first because mtime is unreliable" is a decision and belongs in state, while "next I add the staleness gate" is a plan. The test is whether the turn settled the question or merely queued the work.
conversation — the subject is the exchange itself: what someone asked, what an agent was told, what was delegated, what a message said.
perishable — a true present-tense claim that routine repository motion falsifies: a push, a merge, a release, a branch landing. Unpushed commits, a tag not yet cut, a workflow mid-flight, "ready to push", "not yet published".
recoverable — a true, durable, present-tense claim that reading one file would tell you again: what a command does, which paths a module reads, how a function is wired, a constant's value. It describes the code rather than anything the code cannot say for itself, so it earns nothing by being remembered.

state is the residue: true now, durable, and about something no file states — a decision and why, a constraint the work discovered, a convention, a person's preference. When a claim fits both state and recoverable, answer recoverable.

Answer with the class name alone.`;

const COVERAGE_RUBRIC = `Decide which of the recorded memories states the expected fact, in any wording.

The wording does not have to match. What matters is that someone reading the recorded memory learns the expected fact, with its load-bearing specifics intact. A memory that states something adjacent but not the expected fact does not count.

Answer with the number of the memory that states it, or "none".`;

export type JudgeRunner = (system: string, user: string) => Promise<string>;

export function createJudgeRunner(model: string): JudgeRunner {
  const qualified = normalizeModel(model);
  const client = createModel(qualified, sharedRateLimiter(providerFromModel(qualified)));
  return async (system, user) => {
    const { stream } = await client.doStream({
      prompt: [
        { role: "system", content: system },
        { role: "user", content: [{ type: "text", text: user }] },
      ],
    });
    const reader = stream.getReader();
    let text = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.type === "error") throw value.error instanceof Error ? value.error : new Error(String(value.error));
      if (value.type === "text-delta") text += value.delta;
    }
    return text.trim();
  };
}

function parseClass(answer: string): FactClass | null {
  const word = answer.toLowerCase().match(/state|narration|plan|conversation|perishable|recoverable/)?.[0];
  return word ? factClassSchema.parse(word) : null;
}

/** A fact's class, or null when the judge answered outside its enum — never silently defaulted. */
export async function classifyFact(fact: string, turnText: string, judge: JudgeRunner): Promise<FactClass | null> {
  const answer = await judge(CLASS_RUBRIC, `Turn:\n${turnText}\n\nRecorded memory:\n${fact}`);
  return parseClass(answer);
}

/**
 * The index of the recorded fact that states an expected one, or null when none does. An index
 * rather than a yes: the scope a fact was filed under is only checkable once the fact is named.
 */
export async function matchExpectedFact(
  expected: string,
  facts: readonly string[],
  judge: JudgeRunner,
): Promise<number | null> {
  if (facts.length === 0) return null;
  const listed = facts.map((fact, index) => `${index + 1}. ${fact}`).join("\n");
  const answer = await judge(COVERAGE_RUBRIC, `Expected fact:\n${expected}\n\nRecorded memories:\n${listed}`);
  return parseMatch(answer, facts.length);
}

export function parseMatch(answer: string, factCount: number): number | null {
  const digits = /\d+/.exec(answer);
  if (!digits) return null;
  const ordinal = Number(digits[0]);
  // The judge answers in the listing's 1-based numbers; anything outside it is not a match.
  return ordinal >= 1 && ordinal <= factCount ? ordinal - 1 : null;
}
