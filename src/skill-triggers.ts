import type { ActiveSkill } from "./skill-contract";

const SKILL_TRIGGERS: Record<string, string[]> = {
  build: ["implement", "add feature", "build", "create feature", "new feature", "add functionality"],
  debug: ["debug", "fix bug", "broken", "failing test", "error", "not working", "investigate"],
  tdd: ["test first", "red green", "tdd", "test driven"],
  git: ["commit", "branch", "rebase", "merge", "cherry pick", "squash", "git"],
  review: ["review", "pull request", "pr review", "code review"],
  plan: ["plan", "design", "scope", "break down", "decompose"],
  explore: ["explore", "understand", "how does", "what does", "walk me through"],
  simplify: ["simplify", "reduce complexity", "clean up", "refactor"],
  security: ["security", "vulnerability", "auth", "injection", "xss", "csrf"],
  tests: ["test coverage", "missing tests", "add tests", "test quality"],
  style: ["naming", "code style", "consistency", "conventions"],
  docs: ["documentation", "update docs", "readme", "changelog"],
  architecture: ["architecture", "module boundary", "dependency", "coupling"],
  deprecation: ["deprecate", "remove", "replace", "migrate away"],
  design: ["interface", "api design", "contract", "public api"],
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

export function createSkillSuggestions(message: string, activeSkills?: ActiveSkill[]): string[] {
  return matchSkillTriggers(message, activeSkills).map(
    (name) => `Use \`skill-activate\` to load \`${name}\` before starting.`,
  );
}
