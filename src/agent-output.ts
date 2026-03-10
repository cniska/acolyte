import { t } from "./i18n";

export function formatAssistantOutput(output: string, toolCallCount = 0): string {
  const trimmed = output.trim();
  if (trimmed.length > 0) return trimmed;
  if (toolCallCount > 0) return t("agent.output.no_response_after_tools");
  return t("agent.output.no_output");
}
