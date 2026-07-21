import { expect, test } from "bun:test";
import { composerPresentationContractSchema } from "./chat-viewport-contract";

test("composer contract preserves picker, suggestions, help, and structured status semantics", () => {
  const parsed = composerPresentationContractSchema.safeParse({
    input: { text: "/mo", cursor: 3 },
    placeholder: "Ask",
    focus: true,
    caretVisible: true,
    revision: 1,
    ctrlCPending: false,
    prompt: "chat",
    cursorLine: 0,
    activeIdentity: "sess_1",
    picker: {
      kind: "model",
      query: "",
      items: [{ label: "model", value: "provider/model" }],
      selected: 0,
      scrollOffset: 0,
      hint: "Enter",
    },
    suggestions: {
      kind: "slash",
      candidates: [{ command: "/model", help: "Change model" }],
      selected: 0,
      selectedHelp: "Change model",
    },
    showHelp: true,
    helpEntries: [{ key: "/model", description: "Change model" }],
    helpBreakpoint: 92,
    status: [{ kind: "model", text: "model", role: "plain" }],
  });
  expect(parsed.success).toBe(true);
});
