import { createWorkspaceSpecifier } from "./api";
import { createMessageStreamState } from "./chat-message-handler-stream";
import { createMessage } from "./chat-session";
import { createStdoutRowProjector } from "./cli-stdout-projector";
import type { Client } from "./client-contract";
import { nowIso } from "./datetime";
import { formatPromptError } from "./error-messages";
import { t } from "./i18n";
import type { ResourceId } from "./resource-id";
import type { Session } from "./session-contract";
import { createSkillSuggestion } from "./skill-triggers";
import { printError, printOutput } from "./ui";

function setSessionTitle(session: Session, inputText: string): void {
  if (session.title !== t("chat.session.default_title")) return;
  const title = inputText.trim().replace(/\s+/g, " ").slice(0, 60);
  if (title.length > 0) session.title = title;
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

  const projector = createStdoutRowProjector();
  const streamState = createMessageStreamState({ setRows: projector.setRows });

  try {
    printOutput(`❯ ${prompt}`);

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
        streamState.onEvent(event);
      },
    });
    // Flush any buffered agent text the stream left pending before the final answer.
    streamState.finalize();

    if (reply.error) {
      printError(reply.error);
      return false;
    }
    await projector.renderReply(reply.output);

    const assistantMessage = createMessage("assistant", reply.output);
    session.messages.push(
      (reply.toolCalls?.length ?? 0) > 0 ? { ...assistantMessage, kind: "tool_payload" } : assistantMessage,
    );
    session.model = reply.model;
    session.updatedAt = nowIso();
    return true;
  } catch (error) {
    // A failed turn may leave a flush timer armed; dispose it so buffered text can't
    // write to stdout after we've returned (mirrors the TUI's non-abort catch).
    streamState.dispose();
    if (!(error instanceof Error)) printError(t("error.prompt.request_failed"));
    else printError(formatPromptError(error.message));
    session.updatedAt = nowIso();
    return false;
  }
}
