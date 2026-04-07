import { describe, expect, test } from "bun:test";
import { captureCliOutput } from "./cli-test-harness";

describe("cli test harness", () => {
  test("captureCliOutput cannot be nested", async () => {
    await expect(async () => {
      await captureCliOutput(async () => {
        await captureCliOutput(() => {});
      });
    }).toThrow("captureCliOutput cannot be nested");
  });
});
