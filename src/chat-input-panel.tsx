import { Box, Text } from "ink";
import type React from "react";
import { renderInputPanelContent } from "./chat-input-panel-content";
import { borderLine } from "./chat-layout";
import { type PickerState, pickerHint, pickerTitle, renderPickerItems } from "./chat-picker";
import { PromptInput } from "./prompt-input";

type ChatInputPanelProps = {
  picker: PickerState | null;
  activeSessionId: string | undefined;
  brandColor: string;
  value: string;
  inputRevision: number;
  onChange: (next: string) => void;
  onSubmit: (next: string) => void;
  atQuery: string | null;
  atSuggestions: string[];
  atSuggestionIndex: number;
  slashSuggestions: string[];
  slashSuggestionIndex: number;
  showShortcuts: boolean;
  queuedInput: string | null;
  onPolicyConfirmNoteChange: (next: string) => void;
};

export function ChatInputPanel(props: ChatInputPanelProps): React.ReactNode {
  const {
    picker,
    activeSessionId,
    brandColor,
    value,
    inputRevision,
    onChange,
    onSubmit,
    atQuery,
    atSuggestions,
    atSuggestionIndex,
    slashSuggestions,
    slashSuggestionIndex,
    showShortcuts,
    queuedInput,
    onPolicyConfirmNoteChange,
  } = props;

  if (picker && picker.kind !== "policyConfirm" && picker.kind !== "writeConfirm" && picker.kind !== "clarifyAnswer") {
    return (
      <>
        <Text dimColor>{borderLine()}</Text>
        <Text>{pickerTitle(picker)}</Text>
        <Text> </Text>
        {renderPickerItems(picker, activeSessionId, brandColor)}
        <Text> </Text>
        <Text dimColor>{pickerHint(picker)}</Text>
        <Text dimColor>{borderLine()}</Text>
      </>
    );
  }

  if (picker?.kind === "policyConfirm" || picker?.kind === "writeConfirm" || picker?.kind === "clarifyAnswer") {
    const selected = picker.items[picker.index];
    const isPolicy = picker.kind === "policyConfirm";
    const isWrite = picker.kind === "writeConfirm";
    const isClarify = picker.kind === "clarifyAnswer";
    const firstSelected = isPolicy ? selected?.value === "yes" : isWrite ? selected?.value === "switch" : true;
    const secondSelected = isPolicy ? selected?.value === "no" : isWrite ? selected?.value === "cancel" : false;
    const firstLabel = isPolicy ? "yes" : isWrite ? "switch" : "answer";
    const secondLabel = isPolicy ? "no" : "cancel";
    const firstHint = isPolicy ? "accept" : isWrite ? "switch to write mode" : "continue";
    const secondHint = isPolicy ? "skip" : "stay in read mode";
    const labelWidth = Math.max(firstLabel.length, secondLabel.length);
    return (
      <>
        <Text dimColor>{borderLine()}</Text>
        <Text>{pickerTitle(picker)}</Text>
        <Text> </Text>
        <Box>
          <Text>{firstSelected ? "› " : "  "}</Text>
          <Text color={firstSelected ? brandColor : undefined}>{firstLabel.padEnd(labelWidth, " ")}</Text>
          <Text> </Text>
          {firstSelected ? (
            <PromptInput
              value={picker.note}
              placeholder={isClarify ? "answer…" : "reason…"}
              onChange={onPolicyConfirmNoteChange}
              onSubmit={() => {}}
              key={`policy-confirm-yes-${inputRevision}`}
            />
          ) : (
            <Text dimColor>{firstHint}</Text>
          )}
        </Box>
        {!isClarify && (
          <Box>
            <Text>{secondSelected ? "› " : "  "}</Text>
            <Text color={secondSelected ? brandColor : undefined}>{secondLabel.padEnd(labelWidth, " ")}</Text>
            <Text> </Text>
            {secondSelected ? (
              <PromptInput
                value={picker.note}
                placeholder="reason…"
                onChange={onPolicyConfirmNoteChange}
                onSubmit={() => {}}
                key={`policy-confirm-no-${inputRevision}`}
              />
            ) : (
              <Text dimColor>{secondHint}</Text>
            )}
          </Box>
        )}
        <Text> </Text>
        <Text dimColor>{pickerHint(picker)}</Text>
        <Text dimColor>{borderLine()}</Text>
      </>
    );
  }

  return (
    <>
      <Text dimColor>{borderLine()}</Text>
      <PromptInput
        value={value}
        placeholder="Ask something…"
        linePrefixFirst="❯ "
        linePrefixRest="  "
        onChange={onChange}
        onSubmit={onSubmit}
        key={`chat-input-${inputRevision}`}
      />
      <Text dimColor>{borderLine()}</Text>
      {renderInputPanelContent({
        brandColor,
        atQuery,
        atSuggestions,
        atSuggestionIndex,
        slashSuggestions,
        slashSuggestionIndex,
        showShortcuts,
        queuedInput,
      })}
    </>
  );
}
