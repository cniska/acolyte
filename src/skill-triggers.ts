import type { ActiveSkill } from "./skill-contract";

const SKILL_TRIGGERS: Record<string, string[]> = {
  build: ["implement", "add feature", "create feature", "new feature", "add functionality"],
  debug: ["debug", "fix bug", "broken", "failing test", "not working", "investigate"],
  tdd: ["test first", "red green", "tdd", "test driven"],
  git: ["commit", "rebase", "cherry pick", "squash", "git log", "git diff"],
  review: ["review", "pull request", "pr review", "code review"],
  plan: ["plan this", "scope", "break down", "decompose"],
  explore: ["explore", "how does", "what does", "walk me through"],
  simplify: ["simplify", "reduce complexity", "clean up"],
  security: ["security review", "vulnerability", "injection", "xss", "csrf"],
  tests: ["test coverage", "missing tests", "add tests", "test quality"],
  style: ["code style", "style review", "naming conventions"],
  docs: ["documentation", "update docs"],
  architecture: ["architecture", "module boundary"],
  deprecation: ["deprecate", "migrate away", "phase out"],
  design: ["api design", "design interface", "public api"],
};

function buildTriggerPatterns(): { name: string; pattern: RegExp }[] {
  return Object.entries(SKILL_TRIGGERS).map(([name, keywords]) => {
    const escaped = keywords.map((kw) => kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const pattern = new RegExp(`\\b(?:${escaped.join("|")})\\b`, "i");
    return { name, pattern };
  });
}

const triggerPatterns = buildTriggerPatterns();

export function matchSkillTriggers(message: string, activeSkills?: ActiveSkill[]): string[] {
  const activeNames = new Set(activeSkills?.map((s) => s.name) ?? []);
  return triggerPatterns
    .filter(({ name, pattern }) => !activeNames.has(name) && pattern.test(message))
    .map(({ name }) => name);
}

export function createSkillSuggestion(message: string, activeSkills?: ActiveSkill[]): string | null {
  const matches = matchSkillTriggers(message, activeSkills);
  if (matches.length === 0) return null;
  const names = matches.map((n) => `\`${n}\``).join(", ");
  return `Use \`skill-activate\` to load ${names} before starting.`;
}
