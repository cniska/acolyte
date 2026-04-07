import type { z } from "zod";
import { appConfig } from "./app-config";
import type { CommandContext, CommandResult, SlashCommand } from "./chat-commands-contract";
import { createRow } from "./chat-contract";
import { alignCols } from "./chat-format";
import { formatUsage } from "./cli-help";
import { t } from "./i18n";
import { createSession } from "./storage";
import { createGitWorktree, resolveGitRepoRoot, suggestWorkspaceName, workspaceNameSchema } from "./workspaces-ops";

async function handleWorkspaces(ctx: CommandContext): Promise<CommandResult> {
  const { text, resolvedText } = ctx;
  if (!appConfig.features.parallelWorkspaces) {
    ctx.setRows((current) => [...current, createRow("system", t("chat.workspaces.disabled"))]);
    return { stop: true, userText: text };
  }

  const parts = resolvedText.trim().split(/\s+/);
  const sub = parts[1] ?? "list";

  if (sub === "list" && parts.length <= 2) {
    const workspaces = ctx.store.sessions
      .filter((s) => typeof s.workspaceName === "string" && s.workspaceName.length > 0)
      .map((s) => ({
        id: s.id,
        name: s.workspaceName ?? "",
        branch: s.workspaceBranch ?? "",
        path: s.workspace ?? "",
      }));
    if (workspaces.length === 0) {
      ctx.setRows((current) => [...current, createRow("system", t("chat.workspaces.list.none"))]);
      return { stop: true, userText: text };
    }
    const grid = workspaces.map((ws) => {
      const active = ws.id === ctx.store.activeSessionId ? "●" : " ";
      const branch = ws.branch.length > 0 ? ws.branch : "—";
      const path = ws.path.length > 0 ? ws.path : "—";
      return [`${active} ${ws.name}`, branch, path];
    });
    const list = alignCols(grid);
    ctx.setRows((current) => [
      ...current,
      createRow("system", { header: t("chat.workspaces.header", { count: workspaces.length }), sections: [], list }),
    ]);
    return { stop: true, userText: text };
  }

  if (sub === "new") {
    const args = parts.slice(2);
    const showUsage = (): CommandResult => {
      ctx.setRows((current) => [
        ...current,
        createRow("system", formatUsage("/workspaces new <name> [-- <prompt>]")),
        createRow("system", formatUsage("/workspaces new -- <prompt>")),
      ]);
      return { stop: true, userText: text };
    };

    if (args.length === 0) return showUsage();

    const delimiterIndex = args.indexOf("--");
    let baseName: z.infer<typeof workspaceNameSchema>;
    let prompt = "";
    let isExplicitName = false;

    if (delimiterIndex === -1) {
      if (args.length !== 1) return showUsage();
      const parsedName = workspaceNameSchema.safeParse(args[0]);
      if (!parsedName.success) return showUsage();
      baseName = parsedName.data;
      isExplicitName = true;
    } else if (delimiterIndex === 0) {
      prompt = args.slice(1).join(" ").trim();
      if (prompt.length === 0) {
        ctx.setRows((current) => [...current, createRow("system", formatUsage("/workspaces new -- <prompt>"))]);
        return { stop: true, userText: text };
      }
      baseName = suggestWorkspaceName(prompt);
    } else if (delimiterIndex === 1) {
      const parsedName = workspaceNameSchema.safeParse(args[0]);
      if (!parsedName.success) return showUsage();
      baseName = parsedName.data;
      isExplicitName = true;
      prompt = args.slice(2).join(" ").trim();
    } else {
      ctx.setRows((current) => [
        ...current,
        createRow("system", formatUsage("/workspaces new <name> -- <prompt>")),
        createRow("system", formatUsage("/workspaces new -- <prompt>")),
      ]);
      return { stop: true, userText: text };
    }
    const existing = new Set(
      ctx.store.sessions
        .map((s) => (typeof s.workspaceName === "string" && s.workspaceName.length > 0 ? s.workspaceName : null))
        .filter((s): s is string => typeof s === "string"),
    );
    if (isExplicitName && existing.has(baseName)) {
      ctx.setRows((current) => [...current, createRow("system", t("chat.workspaces.name_conflict"))]);
      return { stop: true, userText: text };
    }
    let name = baseName;
    if (!isExplicitName) {
      for (let n = 2; existing.has(name) && n < 100; n++) {
        const suffix = `-${n}`;
        const trimmed = `${baseName}`.slice(0, Math.max(1, 40 - suffix.length));
        const candidate = `${trimmed}${suffix}`;
        const parsed = workspaceNameSchema.safeParse(candidate);
        if (!parsed.success) continue;
        name = parsed.data;
      }
      if (existing.has(name)) {
        ctx.setRows((current) => [...current, createRow("system", t("chat.workspaces.name_conflict"))]);
        return { stop: true, userText: text };
      }
    }
    let created: { workspacePath: string; branch: string };
    try {
      const repoRoot = await resolveGitRepoRoot(ctx.currentSession.workspace ?? process.cwd());
      created = await createGitWorktree({ repoRoot, name, baseRef: "HEAD" });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown error";
      ctx.setRows((current) => [...current, createRow("system", t("chat.workspaces.create_failed", { reason }))]);
      return { stop: true, userText: text };
    }
    const next = createSession(appConfig.model);
    next.workspaceName = name;
    next.workspace = created.workspacePath;
    next.workspaceBranch = created.branch;
    next.title = prompt.length > 0 ? prompt : name;
    ctx.store.sessions.unshift(next);
    ctx.store.activeSessionId = next.id;
    ctx.setCurrentSession(next);
    ctx.setTokenUsage?.(() => []);
    ctx.clearTranscript(next.id);
    ctx.setRows(() => ctx.toRows(next.messages));
    ctx.setShowHelp(() => false);
    await ctx.persist();
    ctx.setRows((current) => [...current, createRow("system", t("chat.workspaces.created", { name }))]);

    if (prompt.length > 0 && ctx.startAssistantTurn) {
      void ctx.startAssistantTurn(prompt);
      return { stop: true, userText: prompt };
    }
    return { stop: true, userText: text };
  }

  if (sub === "switch") {
    const name = workspaceNameSchema.safeParse(parts[2]);
    if (!name.success || parts.length !== 3) {
      ctx.setRows((current) => [...current, createRow("system", formatUsage("/workspaces switch <name>"))]);
      return { stop: true, userText: text };
    }
    const target = ctx.store.sessions.find((s) => s.workspaceName === name.data);
    if (!target) {
      ctx.setRows((current) => [...current, createRow("system", t("chat.workspaces.not_found", { name: name.data }))]);
      return { stop: true, userText: text };
    }
    ctx.store.activeSessionId = target.id;
    ctx.setCurrentSession(target);
    ctx.setTokenUsage?.(() => target.tokenUsage);
    ctx.clearTranscript(target.id);
    ctx.setRows(() => ctx.toRows(target.messages));
    ctx.setShowHelp(() => false);
    await ctx.persist();
    ctx.setRows((current) => [...current, createRow("system", t("chat.workspaces.switched", { name: name.data }))]);
    return { stop: true, userText: text };
  }

  ctx.setRows((current) => [...current, createRow("system", formatUsage("/workspaces [list|new|switch] ..."))]);
  return { stop: true, userText: text };
}

export function createWorkspacesCommands(ctx: CommandContext): SlashCommand[] {
  return [
    {
      name: "workspaces",
      match: (value) => value === "/workspaces" || value.startsWith("/workspaces "),
      run: () => handleWorkspaces(ctx),
    },
  ];
}
