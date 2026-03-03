import { describe, expect, test } from "bun:test";
import {
  formatResumeCommand,
} from "./cli";

describe("cli", () => {
  test("formatResumeCommand returns prod-friendly command", () => {
    expect(formatResumeCommand("sess_abcdef1234567890")).toBe("acolyte resume sess_abcdef1234567890");
  });
});
