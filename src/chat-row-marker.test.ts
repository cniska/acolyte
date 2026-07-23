import { describe, expect, test } from "bun:test";
import type { ChatRow } from "./chat-contract";
import { rowMarker } from "./chat-row-marker";
import { palette } from "./palette";

function row(kind: ChatRow["kind"], style?: ChatRow["style"]): ChatRow {
  return { id: "row_test", kind, content: "", style };
}

describe("rowMarker", () => {
  test("maps each row kind to its glyph", () => {
    expect(rowMarker(row("user")).glyph).toBe("❯");
    expect(rowMarker(row("assistant")).glyph).toBe("◆");
    expect(rowMarker(row("tool")).glyph).toBe("◆");
    expect(rowMarker(row("status")).glyph).toBe("◆");
    expect(rowMarker(row("task")).glyph).toBe("◆");
    expect(rowMarker(row("system")).glyph).toBe(" ");
  });

  test("defaults the assistant marker to the text color", () => {
    expect(rowMarker(row("assistant")).color).toBe(palette.text);
  });

  test("leaves other kinds uncolored by default", () => {
    expect(rowMarker(row("tool")).color).toBeUndefined();
  });

  test("prefers an explicit style marker color over the default", () => {
    expect(rowMarker(row("status", { markerColor: palette.success })).color).toBe(palette.success);
    expect(rowMarker(row("assistant", { markerColor: palette.error })).color).toBe(palette.error);
  });

  test("resolves the semantic outcome to its palette color", () => {
    expect(rowMarker(row("status", { outcome: "success" })).color).toBe(palette.success);
    expect(rowMarker(row("task", { outcome: "error" })).color).toBe(palette.error);
    expect(rowMarker(row("task", { outcome: "cancelled" })).color).toBe(palette.cancelled);
  });
});
