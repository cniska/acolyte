import { describe, expect, test } from "bun:test";
import { parseStreamEvent, type StreamEvent } from "./client-contract";

describe("parseStreamEvent", () => {
  test("accepts a skill-activated event", () => {
    const event: StreamEvent = { type: "skill-activated", skill: { name: "build", instructions: "slice it" } };
    expect(parseStreamEvent(event)).toEqual(event);
  });

  test("rejects a skill-activated event with a malformed skill", () => {
    expect(parseStreamEvent({ type: "skill-activated", skill: { name: "build" } })).toBeNull();
  });
});
