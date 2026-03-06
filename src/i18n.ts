export type TranslationValue = string | number | boolean;

const EN_MESSAGES = {
  "command.unknown": "Unknown command: {command}",
  "memory.header.all": "Memory {count}",
  "memory.header.scope": "{scope} memory {count}",
  "memory.none": "No {scope}memory saved yet.",
  "memory.rm.ambiguous": "Ambiguous memory id prefix: {prefix}. Matches: {ids}",
  "memory.rm.not_found": "No memory found for id prefix: {prefix}",
  "memory.rm.removed": "Removed {scope} memory {id}.",
  "memory.rm.unavailable": "Memory removal is unavailable in this context.",
  "memory.rm.usage": "Usage: /memory rm <id-prefix>",
  "memory.usage": "Usage: /memory [all|user|project]",
  "model.changed.default": "Changed default model to {model}.",
  "model.changed.mode": "Changed {mode} mode model to {model}.",
  "model.failed": "Failed to set model.",
  "model.usage": "Usage: /model <id> | /model <plan|work|verify|chat> <id>",
  "permissions.changed": "Changed permissions to {mode} ({scope}).",
  "permissions.failed": "Failed to set permission mode.",
  "permissions.stay.read": "Staying in read mode.",
  "permissions.switch.failed": "Failed to switch permission mode.",
  "permissions.switched.write": "Switched to write mode.",
  "permissions.usage": "Usage: /permissions [read|write] [--project|--user]",
  "picker.sessions.none": "No saved sessions.",
  "picker.skills.none": "No skills found in ./.agents/skills.",
  "remember.failed": "Failed to save memory.",
  "remember.saved": "Saved {scope} memory: {content}",
  "remember.usage": "Usage: /remember [--user|--project] <memory text>",
  "scope.all": "All",
  "scope.project": "Project",
  "scope.user": "User",
  "session.started": "Started new session: {sessionId}",
  "sessions.header": "Sessions {count}",
  "skill.activated": "Activated skill: {skill}",
  "skill.activated.with_args": "Activated skill: {skill} (with arguments)",
  "skill.failed": "Failed to activate skill: {skill}",
  "status.check_failed": "Status check failed.",
  "status.empty": "Status response was empty.",
  "tokens.label.budget": "budget:",
  "tokens.label.last_turn": "last_turn:",
  "tokens.label.model_calls": "model_calls:",
  "tokens.label.session": "session:",
  "tokens.label.warning": "warning:",
  "tokens.none": "No token data yet. Send a prompt first.",
  "tokens.turn.one": "turn",
  "tokens.turn.other": "turns",
  "resume.ambiguous": "Ambiguous prefix: {prefix}. Matches: {matches}",
  "resume.not_found": "No session found for prefix: {prefix}",
  "resume.resumed": "Resumed session: {sessionId}",
  "resume.usage": "Usage: /resume <session-id-prefix>",
  "slash.help.exit": "exit chat",
  "slash.help.memory": "show memory notes",
  "slash.help.memory.add": "add memory note",
  "slash.help.memory.all": "show all memory notes",
  "slash.help.memory.list": "show memory notes",
  "slash.help.memory.project": "show project memory notes",
  "slash.help.memory.user": "show user memory notes",
  "slash.help.model": "change model",
  "slash.help.model.chat": "change chat model",
  "slash.help.model.plan": "change plan model",
  "slash.help.model.verify": "change verify model",
  "slash.help.model.work": "change work model",
  "slash.help.new": "start new session",
  "slash.help.permissions": "change permissions",
  "slash.help.permissions.read": "set permissions to read",
  "slash.help.permissions.write": "set permissions to write",
  "slash.help.remember": "save memory note",
  "slash.help.resume": "resume session",
  "slash.help.sessions": "show sessions",
  "slash.help.skill": "run skill command",
  "slash.help.skills": "show skills picker",
  "slash.help.status": "show server status",
  "slash.help.tokens": "show token usage",
} as const;

type TranslationCatalog = {
  [Key in keyof typeof EN_MESSAGES]: string;
};

const TRANSLATIONS = {
  en: EN_MESSAGES,
} as const satisfies Record<string, TranslationCatalog>;

export type TranslationLocale = keyof typeof TRANSLATIONS;
export type TranslationKey = keyof typeof EN_MESSAGES;

type ExtractTemplateVars<T extends string> = T extends `${string}{${infer Name}}${infer Rest}`
  ? Name | ExtractTemplateVars<Rest>
  : never;

type TranslationVarsFor<K extends TranslationKey> = [ExtractTemplateVars<(typeof EN_MESSAGES)[K]>] extends [never]
  ? never
  : {
      [Name in ExtractTemplateVars<(typeof EN_MESSAGES)[K]>]: TranslationValue;
    };

type TranslationArgs<K extends TranslationKey> = [TranslationVarsFor<K>] extends [never] ? [] : [TranslationVarsFor<K>];

function interpolate(template: string, vars?: Record<string, TranslationValue>): string {
  if (!vars) return template;
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (_match, name: string) => {
    const value = vars[name];
    return value === undefined ? `{${name}}` : String(value);
  });
}

export function t<K extends TranslationKey>(key: K, ...args: TranslationArgs<K>): string {
  const vars = (args[0] ?? undefined) as Record<string, TranslationValue> | undefined;
  const locale: TranslationLocale = "en";
  const templates = TRANSLATIONS[locale] ?? TRANSLATIONS.en;
  return interpolate(templates[key], vars);
}
