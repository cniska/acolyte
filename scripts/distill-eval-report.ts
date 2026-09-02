import type { DistillScope } from "../src/distill-ops";
import type { FactClass } from "./distill-eval-judge";

export type GradedFact = {
  readonly fixtureId: string;
  readonly repeat: number;
  readonly content: string;
  readonly scope: DistillScope;
  readonly factClass: FactClass | null;
  readonly unquoted: readonly string[];
  readonly chained: boolean;
  readonly mustNotHits: readonly string[];
};

export type GradedRepeat = {
  readonly fixtureId: string;
  readonly repeat: number;
  readonly facts: readonly GradedFact[];
  /** One entry per `expected` label on the fixture, in the fixture's own order. */
  readonly coverage: readonly boolean[];
  /** Covered expectations the distiller filed under a scope the fixture did not ask for. */
  readonly scopeMismatches: number;
  readonly expectsSilence: boolean;
};

export type EvalReport = {
  readonly prompt: string;
  readonly distillModel: string;
  readonly judgeModel: string;
  readonly repeats: number;
  readonly fixtures: number;
  readonly observations: number;
  readonly observationsPerTurn: number;
  readonly classRates: Readonly<Record<FactClass | "unclassified", number>>;
  readonly perishableAtDurableScope: number;
  readonly quoteViolations: readonly GradedFact[];
  readonly atomicityViolations: readonly GradedFact[];
  readonly mustNotViolations: readonly GradedFact[];
  readonly coverage: number | null;
  readonly scopeMismatches: number;
  readonly silenceCorrectness: number | null;
  readonly perFixture: readonly FixtureSummary[];
};

export type FixtureSummary = {
  readonly fixtureId: string;
  readonly observationsPerRepeat: readonly number[];
  readonly junkRate: number;
  readonly coverage: number | null;
  readonly violations: number;
};

const JUNK_CLASSES: readonly FactClass[] = ["narration", "plan", "conversation"];

function rate(part: number, whole: number): number {
  return whole === 0 ? 0 : part / whole;
}

function junkCount(facts: readonly GradedFact[]): number {
  return facts.filter((fact) => fact.factClass && JUNK_CLASSES.includes(fact.factClass)).length;
}

function summarizeFixture(fixtureId: string, repeats: readonly GradedRepeat[]): FixtureSummary {
  const facts = repeats.flatMap((repeat) => repeat.facts);
  const coverageFlags = repeats.flatMap((repeat) => repeat.coverage);
  return {
    fixtureId,
    observationsPerRepeat: repeats.map((repeat) => repeat.facts.length),
    junkRate: rate(junkCount(facts), facts.length),
    coverage: coverageFlags.length === 0 ? null : rate(coverageFlags.filter(Boolean).length, coverageFlags.length),
    violations: facts.filter((fact) => fact.unquoted.length > 0 || fact.chained || fact.mustNotHits.length > 0).length,
  };
}

/**
 * Aggregates graded repeats into the report. Junk and coverage stay separate figures on purpose: a
 * revision can drive junk to zero by recording nothing, and only the coverage column shows it.
 */
export function aggregate(
  repeats: readonly GradedRepeat[],
  meta: Pick<EvalReport, "prompt" | "distillModel" | "judgeModel" | "repeats">,
): EvalReport {
  const facts = repeats.flatMap((repeat) => repeat.facts);
  const fixtureIds = [...new Set(repeats.map((repeat) => repeat.fixtureId))];

  const classRates = { state: 0, narration: 0, plan: 0, conversation: 0, perishable: 0, unclassified: 0 } as Record<
    FactClass | "unclassified",
    number
  >;
  for (const fact of facts) {
    const key = fact.factClass ?? "unclassified";
    classRates[key] += 1;
  }
  for (const key of Object.keys(classRates) as (FactClass | "unclassified")[]) {
    classRates[key] = rate(classRates[key], facts.length);
  }

  const coverageFlags = repeats.flatMap((repeat) => repeat.coverage);
  const silenceRepeats = repeats.filter((repeat) => repeat.expectsSilence);

  return {
    ...meta,
    fixtures: fixtureIds.length,
    observations: facts.length,
    observationsPerTurn: rate(facts.length, repeats.length),
    classRates,
    perishableAtDurableScope: facts.filter(
      (fact) => fact.factClass === "perishable" && (fact.scope === "project" || fact.scope === "user"),
    ).length,
    quoteViolations: facts.filter((fact) => fact.unquoted.length > 0),
    atomicityViolations: facts.filter((fact) => fact.chained),
    mustNotViolations: facts.filter((fact) => fact.mustNotHits.length > 0),
    coverage: coverageFlags.length === 0 ? null : rate(coverageFlags.filter(Boolean).length, coverageFlags.length),
    scopeMismatches: repeats.reduce((total, repeat) => total + repeat.scopeMismatches, 0),
    silenceCorrectness:
      silenceRepeats.length === 0
        ? null
        : rate(silenceRepeats.filter((repeat) => repeat.facts.length === 0).length, silenceRepeats.length),
    perFixture: fixtureIds.map((id) =>
      summarizeFixture(
        id,
        repeats.filter((repeat) => repeat.fixtureId === id),
      ),
    ),
  };
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function spread(values: readonly number[]): string {
  if (values.length === 0) return "-";
  return `${Math.min(...values)}-${Math.max(...values)}`;
}

export function renderReport(report: EvalReport): string {
  const lines: string[] = [];
  lines.push(`prompt: ${report.prompt}`);
  lines.push(`distill model: ${report.distillModel}    judge model: ${report.judgeModel}`);
  lines.push(`${report.fixtures} fixtures x ${report.repeats} repeats -> ${report.observations} observations`);
  lines.push(`observations per turn: ${report.observationsPerTurn.toFixed(2)}`);
  lines.push("");
  lines.push("class rates");
  for (const [key, value] of Object.entries(report.classRates)) {
    lines.push(`  ${key.padEnd(14)} ${percent(value)}`);
  }
  lines.push("");
  lines.push(`perishable at project/user scope: ${report.perishableAtDurableScope}`);
  lines.push(`quote violations: ${report.quoteViolations.length}`);
  lines.push(`atomicity violations: ${report.atomicityViolations.length}`);
  lines.push(`mustNot violations: ${report.mustNotViolations.length}`);
  lines.push(`coverage: ${report.coverage === null ? "-" : percent(report.coverage)}`);
  lines.push(`scope mismatches: ${report.scopeMismatches}`);
  lines.push(`silence correctness: ${report.silenceCorrectness === null ? "-" : percent(report.silenceCorrectness)}`);
  lines.push("");
  lines.push("per fixture");
  for (const fixture of report.perFixture) {
    const coverage = fixture.coverage === null ? "-" : percent(fixture.coverage);
    lines.push(
      `  ${fixture.fixtureId.padEnd(28)} obs ${spread(fixture.observationsPerRepeat).padEnd(6)} junk ${percent(fixture.junkRate).padEnd(7)} coverage ${coverage.padEnd(7)} violations ${fixture.violations}`,
    );
  }

  const flagged = [...report.quoteViolations, ...report.atomicityViolations, ...report.mustNotViolations];
  if (flagged.length > 0) {
    lines.push("");
    lines.push("flagged facts");
    for (const fact of flagged) {
      const reason = fact.unquoted.length > 0 ? `unquoted ${fact.unquoted.join(", ")}` : "";
      const chained = fact.chained ? "chained claims" : "";
      const must = fact.mustNotHits.length > 0 ? `mustNot ${fact.mustNotHits.join(", ")}` : "";
      lines.push(`  [${fact.fixtureId}] ${[reason, chained, must].filter(Boolean).join(" | ")}`);
      lines.push(`    ${fact.content}`);
    }
  }
  return lines.join("\n");
}
