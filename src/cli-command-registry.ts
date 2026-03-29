import { readFile, writeFile } from "node:fs/promises";
import { appConfig } from "./app-config";
import { createMessage } from "./chat-session";
import { hasHelpFlag } from "./cli-args";
import { attachFileToSession, chatModeWithOptions } from "./cli-chat";
import { configMode } from "./cli-config";
import type { CliCommand, CliCommandHandler, CliCommandHelp } from "./cli-contract";
import { psMode, restartMode, startMode, stopMode } from "./cli-daemon";
import { commandError as commandErrorFromHelp, commandHelp as commandHelpFromHelp, printUsage } from "./cli-help";
import { historyMode } from "./cli-history";
import { initMode } from "./cli-init";
import { logsMode } from "./cli-logs";
import { memoryMode } from "./cli-memory";
import { handlePrompt } from "./cli-prompt";
import { runMode, runResourceId } from "./cli-run";
import { requestLocalServerShutdown } from "./cli-server";
import { skillMode } from "./cli-skill";
import { isServerConnectionFailure, statusMode } from "./cli-status";
import { toolMode } from "./cli-tool";
import { traceMode } from "./cli-trace";
import { createClient } from "./client-factory";
import { compactText } from "./compact-text";
import { readConfig, readConfigForScope, readResolvedConfigSync, setConfigValue, unsetConfigValue } from "./config";
import { t } from "./i18n";
import { fileMemoryStore } from "./memory";
import {
  apiUrlForPort,
  ensureLocalServer,
  listRunningDaemons,
  localServerStatus,
  serverLogPath,
  stopAllLocalServers,
  stopLocalServer,
} from "./server-daemon";
import { findSkillByName, loadSkills, readSkillInstructions } from "./skills";
import { formatStatus } from "./status-format";
import { createSession, readStore } from "./storage";
import { openTraceStore } from "./trace-store";
import { formatCliTitle, printDim, printError, printOutput } from "./ui";

function helpFor(name: string): CliCommandHelp | undefined {
  return COMMAND_REGISTRY[name]?.help;
}

export function commandHelp(name: string): void {
  commandHelpFromHelp(helpFor(name), printDim);
}

export function commandError(name: string, message?: string): void {
  commandErrorFromHelp(helpFor(name), name, printError, message);
}

export function usage(version: string): void {
  const docs = Object.values(COMMAND_REGISTRY).map((entry) => entry.help);
  printUsage(version, docs, printOutput, formatCliTitle);
}

async function resumeMode(args: string[]): Promise<void> {
  if (hasHelpFlag(args)) {
    commandHelp("resume");
    return;
  }
  if (args.length > 1) {
    commandError("resume");
    return;
  }
  const resumePrefix = args[0]?.trim() || undefined;
  await chatModeWithOptions({ resumeLatest: true, resumePrefix });
}

const daemonDeps = {
  apiKey: appConfig.server.apiKey,
  hasHelpFlag,
  port: appConfig.server.port,
  printDim,
  requestLocalServerShutdown,
  serverEntry: `${import.meta.dir}/server.ts`,
  commandError,
  commandHelp,
  ensureLocalServer,
  listRunningDaemons,
  localServerStatus,
  stopLocalServer,
  stopAllLocalServers,
};

const COMMAND_REGISTRY: Record<string, CliCommand> = {
  init: {
    help: {
      command: "init [provider]",
      usage: "acolyte init [openai|anthropic|google]",
      description: t("cli.help.desc.init"),
      examples: ["acolyte init", "acolyte init openai"],
    },
    handler: (args) =>
      initMode(args, {
        cwd: process.cwd,
        hasHelpFlag,
        prompt: (message) => prompt(message),
        printDim,
        printError,
        readFile,
        commandError,
        commandHelp,
        writeFile,
      }),
  },
  resume: {
    help: {
      command: "resume [id]",
      usage: "acolyte resume [id]",
      description: t("cli.help.desc.resume"),
      examples: ["acolyte resume", "acolyte resume sess_abc123"],
    },
    handler: resumeMode,
  },
  run: {
    help: {
      command: "run <prompt>",
      usage: "acolyte run [--file <path>] [--workspace <path>] [--model <id>] <prompt>",
      description: t("cli.help.desc.run"),
      examples: ['acolyte run "summarize README.md"', 'acolyte run --file src/cli.ts "refactor help text"'],
    },
    handler: (args) =>
      runMode(args, {
        apiUrlForPort,
        appModel: appConfig.model,
        attachFileToSession,
        createClient,
        createSession,
        ensureLocalServer,
        hasHelpFlag,
        handlePrompt,
        printDim,
        printError,
        readResolvedConfigSync,
        runResourceId,
        serverApiKey: appConfig.server.apiKey,
        serverEntry: `${import.meta.dir}/server.ts`,
        serverPort: appConfig.server.port,
        commandError,
        commandHelp,
      }),
  },
  history: {
    help: {
      command: "history",
      usage: "acolyte history",
      description: t("cli.help.desc.history"),
      examples: ["acolyte history"],
    },
    handler: (args) =>
      historyMode(args, {
        hasHelpFlag,
        printDim,
        readStore,
        commandError,
        commandHelp,
      }),
  },
  start: {
    help: {
      command: "start",
      usage: "acolyte start",
      description: t("cli.help.desc.start"),
      examples: ["acolyte start"],
    },
    handler: (args) => startMode(args, daemonDeps),
  },
  stop: {
    help: {
      command: "stop",
      usage: "acolyte stop",
      description: t("cli.help.desc.stop"),
      examples: ["acolyte stop"],
    },
    handler: (args) => stopMode(args, daemonDeps),
  },
  restart: {
    help: {
      command: "restart",
      usage: "acolyte restart",
      description: t("cli.help.desc.restart"),
      examples: ["acolyte restart"],
    },
    handler: (args) => restartMode(args, daemonDeps),
  },
  ps: {
    help: {
      command: "ps",
      usage: "acolyte ps",
      description: t("cli.help.desc.ps"),
      examples: ["acolyte ps"],
    },
    handler: (args) => psMode(args, daemonDeps),
  },
  status: {
    help: {
      command: "status",
      usage: "acolyte status",
      description: t("cli.help.desc.status"),
      examples: ["acolyte status"],
    },
    handler: (args) =>
      statusMode(args, {
        apiUrlForPort,
        createClient,
        formatStatus,
        hasHelpFlag,
        hasJsonFlag: (argv) => argv.includes("--json"),
        isServerConnectionFailure,
        localServerStatus,
        printDim,
        printError,
        serverApiKey: appConfig.server.apiKey,
        serverPort: appConfig.server.port,
        commandError,
        commandHelp,
      }),
  },
  memory: {
    help: {
      command: "memory",
      usage: "acolyte memory <list|add> [options]",
      description: t("cli.help.desc.memory"),
      examples: ["acolyte memory list", 'acolyte memory add --project "prefer bun run verify"'],
    },
    handler: (args) =>
      memoryMode(args, {
        store: fileMemoryStore,
        hasHelpFlag,
        printDim,
        commandError,
        commandHelp,
      }),
  },
  config: {
    help: {
      command: "config",
      usage: "acolyte config <list|set|unset> [options]",
      description: t("cli.help.desc.config"),
      examples: ["acolyte config list", "acolyte config set model gpt-5-mini", "acolyte config unset port"],
    },
    handler: (args) =>
      configMode(args, {
        hasHelpFlag,
        printDim,
        printError,
        readConfig,
        readConfigForScope,
        setConfigValue,
        commandError,
        commandHelp,
        unsetConfigValue,
      }),
  },
  skill: {
    help: {
      command: "skill <name> [prompt]",
      usage: "acolyte skill <name> [--file <path>] [--workspace <path>] [--model <id>] <prompt>",
      description: t("cli.help.desc.skill"),
      examples: ['acolyte skill arch-audit "review the lifecycle module"'],
    },
    handler: (args) =>
      skillMode(args, {
        apiUrlForPort,
        appModel: appConfig.model,
        attachFileToSession,
        compactText,
        createClient,
        createMessage,
        createSession,
        ensureLocalServer,
        findSkillByName,
        handlePrompt,
        hasHelpFlag,
        loadSkills,
        printDim,
        printError,
        readResolvedConfigSync,
        readSkillInstructions,
        serverApiKey: appConfig.server.apiKey,
        serverEntry: `${import.meta.dir}/server.ts`,
        serverPort: appConfig.server.port,
        skillBudget: appConfig.agent.skillBudget,
        commandError,
        commandHelp,
      }),
  },
  tool: {
    help: {
      command: "tool",
      usage: "acolyte tool <tool-id> [args...]",
      description: t("cli.help.desc.tool"),
      examples: ['acolyte tool file-find "src/**/*.ts"', "acolyte tool shell-run bun run verify"],
    },
    handler: (args) =>
      toolMode(args, {
        hasHelpFlag,
        printError,
        commandHelp,
      }),
  },
  logs: {
    help: {
      command: "logs",
      usage: "acolyte logs [-n <count>] [--level <level>] [--session <id>] [--since <duration>] [--json]",
      description: t("cli.help.desc.logs"),
      examples: ["acolyte logs", "acolyte logs -n 100", "acolyte logs --level error --since 1h"],
    },
    handler: (args) =>
      logsMode(args, {
        hasHelpFlag,
        logPath: serverLogPath(appConfig.server.port),
        printDim,
        printError,
        readFile,
        commandError,
        commandHelp,
      }),
  },
  trace: {
    help: {
      command: "trace",
      usage: "acolyte trace [list|task <id>] [--lines <n>] [--verbose] [--json]",
      description: t("cli.help.desc.trace"),
      examples: ["acolyte trace", "acolyte trace task task_abc123", "acolyte trace task --verbose"],
    },
    handler: (args) =>
      traceMode(args, {
        hasHelpFlag,
        traceStore: openTraceStore() ?? undefined,
        printDim,
        printError,
        commandError,
        commandHelp,
      }),
  },
};

export const commands: Record<string, CliCommandHandler> = Object.fromEntries(
  Object.entries(COMMAND_REGISTRY).map(([name, entry]) => [name, entry.handler]),
);
