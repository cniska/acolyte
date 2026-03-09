import { readFile, writeFile } from "node:fs/promises";
import { appConfig } from "./app-config";
import { newMessage } from "./chat-session";
import { attachFileToSession, chatModeWithOptions } from "./cli-chat";
import { configMode } from "./cli-config";
import type { CliCommandHandler } from "./cli-contract";

import { subcommandError as subcommandErrorFromHelp, subcommandHelp as subcommandHelpFromHelp } from "./cli-help";
import { historyMode } from "./cli-history";
import { initMode } from "./cli-init";
import { memoryMode } from "./cli-memory";
import { handlePrompt } from "./cli-prompt";
import { runMode, runResourceId } from "./cli-run";
import { serveMode } from "./cli-serve";
import { requestLocalServerShutdown } from "./cli-server";
import { isServerConnectionFailure, statusMode } from "./cli-status";
import { toolMode } from "./cli-tool-mode";
import { createClient } from "./client";
import { readConfig, readConfigForScope, readResolvedConfigSync, setConfigValue, unsetConfigValue } from "./config";

import { addMemory, listMemories } from "./memory";
import {
  apiUrlForPort,
  ensureLocalServer,
  localServerStatus,
  stopAllLocalServers,
  stopLocalServer,
} from "./server-daemon";
import { formatStatusOutput as formatStatusOutputShared } from "./status-format";
import { createSession, readStore } from "./storage";
import { printDim, printError } from "./ui";

function subcommandHelp(name: string): void {
  subcommandHelpFromHelp(name, printDim);
}

function subcommandError(name: string, message?: string): void {
  subcommandErrorFromHelp(name, printError, message);
}

function hasHelpFlag(args: string[]): boolean {
  return args.includes("--help") || args.includes("-h") || args.includes("help");
}

async function resumeMode(args: string[]): Promise<void> {
  if (hasHelpFlag(args)) {
    subcommandHelp("resume");
    return;
  }
  if (args.length > 1) {
    subcommandError("resume");
    return;
  }
  const resumePrefix = args[0]?.trim() || undefined;
  await chatModeWithOptions({ resumeLatest: true, resumePrefix });
}

export const commands: Record<string, CliCommandHandler> = {
  init: (args) =>
    initMode(args, {
      cwd: process.cwd,
      hasHelpFlag,
      prompt: (message) => prompt(message),
      printDim,
      printError,
      readFile,
      subcommandError,
      subcommandHelp,
      writeFile,
    }),
  resume: resumeMode,
  run: (args) =>
    runMode(args, {
      apiUrlForPort,
      appModel: appConfig.model,
      attachFileToSession,
      createClient,
      createSession,
      ensureLocalServer,
      hasHelpFlag,
      handlePrompt,
      newMessage,
      printDim,
      printError,
      readResolvedConfigSync,
      runResourceId,
      serverApiKey: appConfig.server.apiKey,
      serverEntry: `${import.meta.dir}/server.ts`,
      serverPort: appConfig.server.port,
      subcommandError,
      subcommandHelp,
    }),
  history: (args) =>
    historyMode(args, {
      hasHelpFlag,
      printDim,
      readStore,
      subcommandError,
      subcommandHelp,
    }),
  server: (args) =>
    serveMode(args, {
      apiKey: appConfig.server.apiKey,
      hasHelpFlag,
      port: appConfig.server.port,
      printDim,
      requestLocalServerShutdown,
      serverEntry: `${import.meta.dir}/server.ts`,
      subcommandError,
      subcommandHelp,
      ensureLocalServer,
      localServerStatus,
      stopLocalServer,
      stopAllLocalServers,
    }),
  status: (args) =>
    statusMode(args, {
      apiUrlForPort,
      createClient,
      formatStatusOutput: formatStatusOutputShared,
      hasHelpFlag,
      isServerConnectionFailure,
      localServerStatus,
      printDim,
      printError,
      serverApiKey: appConfig.server.apiKey,
      serverPort: appConfig.server.port,
      subcommandError,
      subcommandHelp,
    }),
  memory: (args) =>
    memoryMode(args, {
      addMemory,
      hasHelpFlag,
      listMemories,
      printDim,
      subcommandError,
      subcommandHelp,
    }),
  config: (args) =>
    configMode(args, {
      hasHelpFlag,
      printDim,
      printError,
      readConfig,
      readConfigForScope,
      setConfigValue,
      subcommandError,
      subcommandHelp,
      unsetConfigValue,
    }),
  tool: toolMode,
};
