import { describe, expect, test } from "bun:test";
import { aggregate, type GradedFact, type GradedRepeat, renderReport } from "./distill-eval-report";

const META = { prompt: "current", distillModel: "m", judgeModel: "j", repeats: 1 };

function fact(overrides: Partial<GradedFact> = {}): GradedFact {
  return {
    fixtureId: "f1",
    repeat: 0,
    content: "the pre-push hook rejects placeholder author domains",
    scope: "project",
    factClass: "state",
    unquoted: [],
    chained: false,
    mustNotHits: [],
    ...overrides,
  };
}

function repeat(overrides: Partial<GradedRepeat> = {}): GradedRepeat {
  return {
    fixtureId: "f1",
    repeat: 0,
    facts: [fact()],
    coverage: [],
    scopeMismatches: 0,
    expectsSilence: false,
    ...overrides,
  };
}

describe("aggregate", () => {
  test("a revision that records nothing shows as coverage loss, not as a junk win", () => {
    const silent = aggregate([repeat({ facts: [], coverage: [false, false] })], META);
    expect(silent.classRates.narration).toBe(0);
    expect(silent.coverage).toBe(0);
    expect(silent.observations).toBe(0);
  });

  test("junk rates are per class so one class cannot hide inside an aggregate", () => {
    const report = aggregate(
      [
        repeat({
          facts: [fact({ factClass: "narration" }), fact({ factClass: "plan" }), fact({ factClass: "state" })],
        }),
      ],
      META,
    );
    expect(report.classRates.narration).toBeCloseTo(1 / 3);
    expect(report.classRates.plan).toBeCloseTo(1 / 3);
    expect(report.classRates.state).toBeCloseTo(1 / 3);
  });

  test("perishable counts only against a scope that outlives the session", () => {
    const report = aggregate(
      [
        repeat({
          facts: [
            fact({ factClass: "perishable", scope: "project" }),
            fact({ factClass: "perishable", scope: "session" }),
          ],
        }),
      ],
      META,
    );
    expect(report.perishableAtDurableScope).toBe(1);
    expect(report.classRates.perishable).toBe(1);
  });

  test("an answer outside the judge's enum is counted, never folded into state", () => {
    const report = aggregate([repeat({ facts: [fact({ factClass: null })] })], META);
    expect(report.classRates.unclassified).toBe(1);
    expect(report.classRates.state).toBe(0);
  });

  test("silence correctness reads only the fixtures that expect silence", () => {
    const report = aggregate(
      [
        repeat({ fixtureId: "quiet", facts: [], expectsSilence: true }),
        repeat({ fixtureId: "noisy", facts: [fact()], expectsSilence: true }),
        repeat({ fixtureId: "work", facts: [fact()], expectsSilence: false }),
      ],
      META,
    );
    expect(report.silenceCorrectness).toBe(0.5);
  });

  test("a session-scoped note answers a nothing-turn as well as silence does", () => {
    const report = aggregate(
      [repeat({ facts: [fact({ scope: "session", factClass: "perishable" })], expectsSilence: true })],
      META,
    );
    expect(report.silenceCorrectness).toBe(1);
    expect(report.perishableAtDurableScope).toBe(0);
  });

  test("a durable fact on a nothing-turn is still a silence failure", () => {
    const report = aggregate([repeat({ facts: [fact({ scope: "project" })], expectsSilence: true })], META);
    expect(report.silenceCorrectness).toBe(0);
  });

  test("a fact one file read would tell you again counts as junk", () => {
    const report = aggregate([repeat({ facts: [fact({ factClass: "recoverable" })] })], META);
    expect(report.classRates.recoverable).toBe(1);
    expect(report.perFixture[0].junkRate).toBe(1);
  });

  test("silence correctness is absent rather than perfect when no fixture expects silence", () => {
    expect(aggregate([repeat()], META).silenceCorrectness).toBeNull();
  });

  test("per-fixture volume carries the repeat spread so a difference can be read as noise", () => {
    const report = aggregate(
      [
        repeat({ repeat: 0, facts: [fact(), fact()] }),
        repeat({ repeat: 1, facts: [] }),
        repeat({ repeat: 2, facts: [fact()] }),
      ],
      META,
    );
    expect(report.perFixture[0].observationsPerRepeat).toEqual([2, 0, 1]);
    expect(report.observationsPerTurn).toBeCloseTo(1);
  });

  test("a covered fact filed under the wrong scope counts as a mismatch, not a coverage loss", () => {
    const report = aggregate([repeat({ coverage: [true], scopeMismatches: 1 })], META);
    expect(report.coverage).toBe(1);
    expect(report.scopeMismatches).toBe(1);
  });

  test("violations are listed verbatim so a human can overrule them", () => {
    const flagged = fact({ unquoted: ["50 turns"], content: "the budget is 50 turns" });
    const report = aggregate([repeat({ facts: [flagged] })], META);
    expect(report.quoteViolations).toHaveLength(1);
    expect(report.quoteViolations[0].content).toBe("the budget is 50 turns");
  });
});

describe("renderReport", () => {
  test("a violation count carries its rate, so runs of different sizes compare", () => {
    const bad = fact({ chained: true, unquoted: ["41.2k"] });
    const one = renderReport(aggregate([repeat({ facts: [bad, fact()] })], META));
    const twice = renderReport(aggregate([repeat({ facts: [bad, fact(), bad, fact()] })], META));

    expect(one).toContain("atomicity violations: 1 (50.0%)");
    expect(twice).toContain("atomicity violations: 2 (50.0%)");
  });
});
