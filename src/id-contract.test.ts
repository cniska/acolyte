import { describe, expect, test } from "bun:test";
import { domainIdSchema, remapDomainId } from "./id-contract";

describe("id-contract", () => {
  test("domainIdSchema validates correct format", () => {
    const schema = domainIdSchema("msg");
    expect(schema.safeParse("msg_abc123").success).toBe(true);
    expect(schema.safeParse("msg_").success).toBe(false);
    expect(schema.safeParse("row_abc123").success).toBe(false);
    expect(schema.safeParse("abc123").success).toBe(false);
  });

  test("remapDomainId swaps prefix", () => {
    expect(remapDomainId("msg_abc123", "row")).toBe("row_abc123");
    expect(remapDomainId("row_abc123", "msg")).toBe("msg_abc123");
  });

  test("remapDomainId handles id without prefix", () => {
    expect(remapDomainId("abc123", "row")).toBe("row_abc123");
  });
});
