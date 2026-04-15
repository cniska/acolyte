import type { ActiveSkill } from "./skill-contract";

type SkillTriggerMeta = {
  keywords: string[];
  useWhen: string;
};

const SKILL_TRIGGER_META: Record<string, SkillTriggerMeta> = {
  architecture: {
    keywords: ["architecture", "module boundary"],
    useWhen: "Use when reviewing module boundaries, extension seams, or contract drift.",
  },
  build: {
    keywords: ["implement", "add feature", "create feature", "new feature", "add functionality"],
    useWhen: "Use when building features, adding functionality, or implementing tasks that touch multiple files.",
  },
  debug: {
    keywords: ["debug", "fix bug", "broken", "failing test", "not working", "investigate"],
    useWhen: "Use when tests fail, builds break, or runtime behavior doesn't match expectations.",
  },
  deprecation: {
    keywords: ["deprecate", "migrate away", "phase out"],
    useWhen: "Use when replacing systems, removing unused features, or consolidating duplicate implementations.",
  },
  design: {
    keywords: ["api design", "design interface", "public api"],
    useWhen: "Use when defining contracts, module boundaries, or public APIs.",
  },
  docs: {
    keywords: ["documentation", "update docs"],
    useWhen: "Use when code changes should be reflected in documentation.",
  },
  explore: {
    keywords: ["explore", "how does", "what does", "walk me through"],
    useWhen: "Use before implementing complex or ambiguous work.",
  },
  git: {
    keywords: ["commit", "rebase", "cherry pick", "squash", "git log", "git diff"],
    useWhen: "Use when committing, branching, or managing version control.",
  },
  plan: {
    keywords: ["plan this", "scope", "break down", "decompose"],
    useWhen: "Use when asked to plan, scope, design, or break down work before coding.",
  },
  review: {
    keywords: ["review", "pull request", "pr review", "code review"],
    useWhen: "Use when reviewing a feature branch before merge.",
  },
  security: {
    keywords: ["security review", "vulnerability", "injection", "xss", "csrf"],
    useWhen: "Use when reviewing security posture or assessing risk before release.",
  },
  simplify: {
    keywords: ["simplify", "reduce complexity", "clean up"],
    useWhen:
      "Use after a feature is working, during review when complexity is flagged, or when encountering unclear code.",
  },
  style: {
    keywords: ["code style", "style review", "naming conventions"],
    useWhen: "Use when reviewing code quality or style drift.",
  },
  tdd: {
    keywords: ["test first", "red green", "tdd", "test driven"],
    useWhen: "Use when building features or fixing bugs test-first.",
  },
  tests: {
    keywords: ["test coverage", "missing tests", "add tests", "test quality"],
    useWhen: "Use when reviewing whether changed code has adequate tests.",
  },
};

function buildTriggerPatterns(): { name: string; pattern: RegExp }[] {
  return Object.entries(SKILL_TRIGGER_META).map(([name, meta]) => {
    const escaped = meta.keywords.map((kw) => kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const pattern = new RegExp(`\\b(?:${escaped.join("|")})\\b`, "i");
    return { name, pattern };
  });
}

export function getSkillUseWhen(name: string): string | undefined {
  return SKILL_TRIGGER_META[name]?.useWhen;
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
