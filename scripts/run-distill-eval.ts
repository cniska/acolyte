import { readFile } from "node:fs/promises";
import { appConfig } from "../src/app-config";
import { hasBoolFlag, parseFlag } from "../src/cli-args";
import { DISTILLER_PROMPT, defaultRunner } from "../src/memory-distiller";
import { chainedClaims, unquotedSpecifics, violatedMustNot } from "./distill-eval-checks";
import {
  captureFixture,
  type DistillFixture,
  FIXTURE_DIR,
  findTurns,
  fixtureTurnText,
  loadFixtures,
  writeFixture,
} from "./distill-eval-fixtures";
import { classifyFact, createJudgeRunner, type JudgeRunner, matchExpectedFact } from "./distill-eval-judge";
import { aggregate, type GradedFact, type GradedRepeat, renderReport } from "./distill-eval-report";
import { toPrettyJson } from "./perf-test-utils";

const DEFAULT_REPEATS = 5;
// The window `commit` slices a turn's history to, so a fixture holds what the model would be shown.
const CONTEXT_MESSAGE_WINDOW = 20;

const USAGE = `Usage:
  run-distill-eval.ts [--prompt <file>] [--model <id>] [--judge-model <id>] [--judge-base-url <url>]
                      [--repeats <n>] [--fixtures <dir>] [--only <id,...>] [--json]
  run-distill-eval.ts --capture <transcript.jsonl> --turn <n> --id <name> [--note <text>] [--fixtures <dir>]
  run-distill-eval.ts --find <transcript.jsonl> --pattern <regex>`;

/**
 * Every fixture that records a measured corruption must have it caught by one of the checks, run
 * against the real turn. A fixture whose own failure now passes silently has stopped measuring
 * anything, so the run stops rather than reporting rates nobody should trust.
 */
export function redProof(fixtures: readonly DistillFixture[]): string[] {
  const uncaught: string[] = [];
  for (const fixture of fixtures) {
    if (!fixture.measuredFailure) continue;
    const turnText = fixtureTurnText(fixture);
    const caught =
      unquotedSpecifics(fixture.measuredFailure, turnText).length > 0 ||
      chainedClaims(fixture.measuredFailure) ||
      violatedMustNot(fixture.measuredFailure, fixture.mustNot).length > 0;
    if (!caught) uncaught.push(fixture.id);
  }
  return uncaught;
}

async function gradeRepeat(
  fixture: DistillFixture,
  prompt: string,
  model: string,
  judge: JudgeRunner,
  repeatIndex: number,
): Promise<GradedRepeat> {
  const turnText = fixtureTurnText(fixture);
  const observations = await defaultRunner(prompt, turnText, model);

  const facts: GradedFact[] = [];
  for (const observation of observations) {
    facts.push({
      fixtureId: fixture.id,
      repeat: repeatIndex,
      content: observation.content,
      scope: observation.scope,
      factClass: await classifyFact(observation.content, turnText, judge),
      unquoted: unquotedSpecifics(observation.content, turnText),
      chained: chainedClaims(observation.content),
      mustNotHits: violatedMustNot(observation.content, fixture.mustNot),
    });
  }

  const coverage: boolean[] = [];
  let scopeMismatches = 0;
  for (const expectation of fixture.expected) {
    const matched = await matchExpectedFact(
      expectation.fact,
      facts.map((fact) => fact.content),
      judge,
    );
    coverage.push(matched !== null);
    if (matched !== null && facts[matched]?.scope !== expectation.scope) scopeMismatches += 1;
  }

  return {
    fixtureId: fixture.id,
    repeat: repeatIndex,
    facts,
    coverage,
    scopeMismatches,
    expectsSilence: fixture.expectsSilence,
  };
}

async function runEval(args: string[]): Promise<void> {
  const promptFile = parseFlag(args, "--prompt");
  const prompt = promptFile ? await readFile(promptFile, "utf8") : DISTILLER_PROMPT;
  const model = parseFlag(args, "--model") ?? appConfig.model;
  if (!model) throw new Error("No model configured; pass --model <id> or set one with acolyte config set model");
  const judgeModel = parseFlag(args, "--judge-model") ?? model;
  const repeats = Number(parseFlag(args, "--repeats") ?? DEFAULT_REPEATS);
  const dir = parseFlag(args, "--fixtures") ?? FIXTURE_DIR;
  const only = parseFlag(args, "--only")
    ?.split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const json = hasBoolFlag(args, "--json");

  if (!Number.isInteger(repeats) || repeats < 1) throw new Error("--repeats must be a positive integer");

  const all = await loadFixtures(dir);
  const fixtures = only ? all.filter((fixture) => only.includes(fixture.id)) : all;
  if (fixtures.length === 0) throw new Error(`no fixtures in ${dir}`);

  const uncaught = redProof(fixtures);
  if (uncaught.length > 0) {
    throw new Error(`no check catches the recorded failure in: ${uncaught.join(", ")}`);
  }

  const judge = createJudgeRunner(judgeModel, parseFlag(args, "--judge-base-url"));
  const graded: GradedRepeat[] = [];
  for (const fixture of fixtures) {
    for (let repeatIndex = 0; repeatIndex < repeats; repeatIndex++) {
      graded.push(await gradeRepeat(fixture, prompt, model, judge, repeatIndex));
      if (!json) process.stdout.write(".");
    }
  }
  if (!json) process.stdout.write("\n\n");

  const report = aggregate(graded, {
    prompt: promptFile ?? "DISTILLER_PROMPT",
    distillModel: model,
    judgeModel,
    repeats,
  });
  process.stdout.write(json ? `${toPrettyJson(report)}\n` : `${renderReport(report)}\n`);
  if (judgeModel === model) {
    process.stdout.write("\nnote: judge and distiller are the same model, so they share blind spots.\n");
  }
}

async function runCapture(args: string[]): Promise<void> {
  const transcriptPath = parseFlag(args, "--capture");
  const turn = Number(parseFlag(args, "--turn"));
  const id = parseFlag(args, "--id");
  if (!transcriptPath || !id || !Number.isInteger(turn)) throw new Error(USAGE);

  const fixture = await captureFixture({
    transcriptPath,
    turnIndex: turn,
    id,
    contextMessageWindow: CONTEXT_MESSAGE_WINDOW,
    note: parseFlag(args, "--note"),
  });
  const path = await writeFixture(fixture, parseFlag(args, "--fixtures") ?? FIXTURE_DIR);
  process.stdout.write(`${path}\n`);
  process.stdout.write(
    "redact it, then add expected facts and mustNot labels — or expectsSilence — before committing.\n",
  );
}

async function runFind(args: string[]): Promise<void> {
  const transcriptPath = parseFlag(args, "--find");
  const pattern = parseFlag(args, "--pattern");
  if (!transcriptPath || !pattern) throw new Error(USAGE);
  for (const turn of await findTurns(transcriptPath, new RegExp(pattern, "i"))) {
    process.stdout.write(`${String(turn.index).padStart(4)}  ${turn.prompt.replace(/\s+/g, " ")}\n`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (hasBoolFlag(args, "--help") || hasBoolFlag(args, "-h")) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  if (parseFlag(args, "--find")) return runFind(args);
  if (parseFlag(args, "--capture")) return runCapture(args);
  return runEval(args);
}

if (import.meta.main) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
