import { describe, expect, test } from "bun:test";
import { classifyFact, type JudgeRunner, matchExpectedFact, parseMatch } from "./distill-eval-judge";

const answering =
  (answer: string): JudgeRunner =>
  async () =>
    answer;

describe("classifyFact", () => {
  test("reads a class the judge named", async () => {
    expect(await classifyFact("a fact", "a turn", answering("perishable"))).toBe("perishable");
  });

  test("returns null when the judge answers outside its enum, rather than guessing", async () => {
    expect(await classifyFact("a fact", "a turn", answering("mostly fine, I'd say"))).toBeNull();
  });

  test("a judge that reasons past the class name is no class, not the first word it used", async () => {
    expect(await classifyFact("a fact", "a turn", answering("this is not a plan, it is state"))).toBeNull();
  });
});

describe("parseMatch", () => {
  test("reads the judge's 1-based ordinal as an index", () => {
    expect(parseMatch("2", 3)).toBe(1);
  });

  test("treats an ordinal past the listing as no match", () => {
    expect(parseMatch("4", 3)).toBeNull();
  });

  test("treats a refusal as no match", () => {
    expect(parseMatch("none", 3)).toBeNull();
  });

  test("a judge that reasons instead of answering is no match, not the digit it happened to use", () => {
    expect(parseMatch("none of the 3 memories state it", 3)).toBeNull();
    expect(parseMatch("memory 2 is closest, but no", 3)).toBeNull();
  });
});

describe("matchExpectedFact", () => {
  test("is no match when nothing was recorded, without asking the judge", async () => {
    const judge: JudgeRunner = async () => {
      throw new Error("judge must not be called");
    };
    expect(await matchExpectedFact("a fact", [], judge)).toBeNull();
  });

  test("names which recorded fact states the expectation", async () => {
    expect(await matchExpectedFact("a fact", ["wrong", "right"], answering("2"))).toBe(1);
  });
});
