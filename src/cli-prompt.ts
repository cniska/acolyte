import { stdout as output } from "node:process";
import { createWorkspaceSpecifier } from "./api";
import { createMessage } from "./chat-session";
import { formatChecklist } from "./checklist-format";
import { formatAgentReplyOutput, printIndentedDim } from "./cli-format";
import type { Client } from "./client-contract";
import { nowIso } from "./datetime";
import { LIFECYCLE_ERROR_CODES } from "./error-contract";
import { formatPromptError } from "./error-messages";
import { t } from "./i18n";
import type { ResourceId } from "./resource-id";
import type { Session } from "./session-contract";
import { createSkillSuggestion } from "./skill-triggers";
import { createToolOutputState, renderToolOutput } from "./tool-output-render";
import { printDim, printError, printOutput, streamText } from "./ui";

function setSessionTitle(session: Session, inputText: string): void {
  if (session.title !== t("chat.session.default_title")) return;
  const title = inputText.trim().replace(/\s+/g, " ").slice(0, 60);
  if (title.length > 0) session.title = title;
}

function missingAgentStreamTail(streamed: string, finalOutput: string): string {
  if (streamed.length === 0) return finalOutput;
  if (finalOutput === streamed) return "";
  if (finalOutput.startsWith(streamed)) return finalOutput.slice(streamed.length);
  return "";
}

function createAgentStreamRenderer(): {
  onDelta: (delta: string) => void;
  renderReply: (replyOutput: string, hasPrintedProgress: boolean) => Promise<void>;
  streamedText: () => string;
} {
  let agentStreamStarted = false;
  let agentStreamText = "";
  let atLineStart = true;

  const writeRaw = (text: string): void => {
    if (text.length === 0) return;
    let remaining = text;
    while (remaining.length > 0) {
      if (atLineStart) {
        const prefix = agentStreamStarted ? "  " : "• ";
        process.stdout.write(prefix);
        agentStreamStarted = true;
      }
      const newlineIndex = remaining.indexOf("\n");
      if (newlineIndex === -1) {
        process.stdout.write(remaining);
        atLineStart = false;
        break;
      }
      process.stdout.write(`${remaining.slice(0, newlineIndex)}\n`);
      remaining = remaining.slice(newlineIndex + 1);
      atLineStart = true;
    }
  };

  return {
    onDelta: (delta) => {
      if (delta.length === 0) return;
      agentStreamText += delta;
      writeRaw(delta);
    },
    renderReply: async (replyOutput, hasPrintedProgress) => {
      if (!atLineStart) process.stdout.write("\n");
      printOutput("");
      if (hasPrintedProgress) printOutput("");
      const missingTail = missingAgentStreamTail(agentStreamText, replyOutput);
      if (missingTail.length > 0) {
        writeRaw(missingTail);
        if (!atLineStart) process.stdout.write("\n");
      } else if (!agentStreamStarted) {
        const wrapWidth = Math.max(24, (output.columns ?? 120) - 4);
        await streamText(formatAgentReplyOutput(replyOutput, wrapWidth));
      }
    },
    streamedText: () => agentStreamText,
  };
}

export async function handlePrompt(
  prompt: string,
  session: Session,
  client: Client,
  options?: { resourceId?: ResourceId; workspace?: string },
): Promise<boolean> {
  const userMsg = createMessage("user", prompt);
  session.messages.push(userMsg);
  setSessionTitle(session, prompt);

  try {
    printOutput(`❯ ${prompt}`);
    const agentRenderer = createAgentStreamRenderer();
    const toolOutput = createToolOutputState();
    const snapshotByCallId = new Map<string, string>();
    let hasPrintedToolProgress = false;

    const suggestions: string[] = [];
    const skillSuggestion = createSkillSuggestion(prompt, session.activeSkills);
    if (skillSuggestion) suggestions.push(skillSuggestion);

    const reply = await client.replyStream({
      request: {
        message: prompt,
        history: session.messages,
        model: session.model,
        sessionId: session.id,
        activeSkills: session.activeSkills,
        suggestions,
        resourceId: options?.resourceId,
        ...createWorkspaceSpecifier(options?.workspace),
      },
      onEvent: (event) => {
        switch (event.type) {
          case "text-delta":
            agentRenderer.onDelta(event.text);
            break;
          case "tool-output": {
            const update = toolOutput.push(event);
            if (!update) break;
            if (update.items.length === 1 && update.items[0]?.kind === "tool-header" && !update.items[0].detail) break;
            const rendered = renderToolOutput(update.items);
            if (!rendered) break;
            const previous = snapshotByCallId.get(event.toolCallId);
            snapshotByCallId.set(event.toolCallId, rendered);
            if (previous) {
              const current = rendered.trimEnd();
              const before = previous.trimEnd();
              if (current === before) break;
              if (current.startsWith(`${before}\n`)) {
                printIndentedDim(current.slice(before.length + 1));
                hasPrintedToolProgress = true;
                break;
              }
              const currentLines = current.split("\n");
              const previousLines = before.split("\n");
              if (currentLines.length > previousLines.length) {
                printIndentedDim(currentLines.slice(previousLines.length).join("\n"));
                hasPrintedToolProgress = true;
                break;
              }
              break;
            }
            printDim(`• ${rendered.split("\n")[0] ?? ""}`);
            if (rendered.includes("\n")) printIndentedDim(rendered.slice(rendered.indexOf("\n") + 1));
            hasPrintedToolProgress = true;
            break;
          }
          case "checklist": {
            const { header, items } = formatChecklist(event);
            printDim(`• ${header}`);
            for (const item of items) printIndentedDim(`${item.marker} ${item.label}`);
            hasPrintedToolProgress = true;
            break;
          }
          case "tool-result": {
            const budgetExhausted =
              event.isError === true &&
              (event.errorCode === LIFECYCLE_ERROR_CODES.budgetExhausted ||
                event.error?.category === "budget-exhausted");
            if (budgetExhausted) toolOutput.delete(event.toolCallId);
            break;
          }
        }
      },
    });

    if (reply.error) {
      printError(reply.error);
    } else {
      await agentRenderer.renderReply(reply.output, hasPrintedToolProgress);
    }
    const assistantMessage = createMessage("assistant", reply.output);
    session.messages.push(
      (reply.toolCalls?.length ?? 0) > 0 ? { ...assistantMessage, kind: "tool_payload" } : assistantMessage,
    );
    session.model = reply.model;
    session.updatedAt = nowIso();
    return true;
  } catch (error) {
    if (!(error instanceof Error)) printError(t("error.prompt.request_failed"));
    else printError(formatPromptError(error.message));
    session.updatedAt = nowIso();
    return false;
  }
}
