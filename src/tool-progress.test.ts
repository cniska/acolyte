import { describe, expect, test } from "bun:test";
import { groupToolProgressMessages, isToolDetailLine, isToolHeaderLine } from "./tool-progress";

describe("tool progress helpers", () => {
  test("detects tool headers and detail lines", () => {
    expect(isToolHeaderLine("Edited sum.rs")).toBe(true);
    expect(isToolHeaderLine("Ran rustc sum.rs")).toBe(true);
    expect(isToolHeaderLine("Working…")).toBe(false);
    expect(isToolDetailLine("1 + fn main() {}")).toBe(true);
    expect(isToolDetailLine("2 - old")).toBe(true);
    expect(isToolDetailLine("exit_code=0")).toBe(false);
  });

  test("groups split header and detail messages", () => {
    const out = groupToolProgressMessages([
      "Edited sum.rs",
      "1 + fn main() {}",
      '2 + println!("ok");',
      "Deleted sum.rs",
    ]);
    expect(out).toEqual(['Edited sum.rs\n1 + fn main() {}\n2 + println!("ok");', "Deleted sum.rs"]);
  });

  test("dedupes duplicate messages while grouping", () => {
    const out = groupToolProgressMessages(["Edited sum.rs", "Edited sum.rs", "1 + fn main() {}", "1 + fn main() {}"]);
    expect(out).toEqual(["Edited sum.rs\n1 + fn main() {}"]);
  });
});
