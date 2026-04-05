import architectureMd from "../docs/skills/architecture.md" with { type: "text" };
import buildMd from "../docs/skills/build.md" with { type: "text" };
import debugMd from "../docs/skills/debug.md" with { type: "text" };
import deprecationMd from "../docs/skills/deprecation.md" with { type: "text" };
import designMd from "../docs/skills/design.md" with { type: "text" };
import docsMd from "../docs/skills/docs.md" with { type: "text" };
import exploreMd from "../docs/skills/explore.md" with { type: "text" };
import gitMd from "../docs/skills/git.md" with { type: "text" };
import planMd from "../docs/skills/plan.md" with { type: "text" };
import reviewMd from "../docs/skills/review.md" with { type: "text" };
import securityMd from "../docs/skills/security.md" with { type: "text" };
import simplifyMd from "../docs/skills/simplify.md" with { type: "text" };
import styleMd from "../docs/skills/style.md" with { type: "text" };
import tddMd from "../docs/skills/tdd.md" with { type: "text" };
import testsMd from "../docs/skills/tests.md" with { type: "text" };

export interface BundledSkill {
  name: string;
  description: string;
  content: string;
}

export const BUNDLED_SKILLS: readonly BundledSkill[] = [
  {
    name: "architecture",
    description:
      "Review architecture, boundaries, and design consistency. Use when reviewing module boundaries, extension seams, or contract drift.",
    content: architectureMd,
  },
  {
    name: "build",
    description:
      "Implement features incrementally through vertical slices. Use when building features, adding functionality, or implementing tasks that touch multiple files.",
    content: buildMd,
  },
  {
    name: "debug",
    description:
      "Debug systematically with structured triage. Use when tests fail, builds break, or runtime behavior doesn't match expectations.",
    content: debugMd,
  },
  {
    name: "deprecation",
    description:
      "Deprecate and remove code safely. Use when replacing systems, removing unused features, or consolidating duplicate implementations.",
    content: deprecationMd,
  },
  {
    name: "design",
    description:
      "Design stable interfaces that are hard to misuse. Use when defining tool contracts, RPC payloads, module boundaries, or public APIs.",
    content: designMd,
  },
  {
    name: "docs",
    description:
      "Review docs for drift, missing updates, and terminology changes. Use when code changes should be reflected in documentation.",
    content: docsMd,
  },
  {
    name: "explore",
    description:
      "Explore a task or design through systematic questions until reaching shared understanding. Use before implementing complex or ambiguous work.",
    content: exploreMd,
  },
  {
    name: "git",
    description: "Manage commits, branches, and change history. Use when committing, branching, or managing version control.",
    content: gitMd,
  },
  {
    name: "plan",
    description:
      "Design a feature or behavior change through dialogue. Use when asked to plan, scope, design, or break down work before coding.",
    content: planMd,
  },
  {
    name: "review",
    description: "Run all review skills against the current branch diff. Use when reviewing a feature branch before merge.",
    content: reviewMd,
  },
  {
    name: "security",
    description:
      "Review security risks, trust boundaries, and unsafe defaults. Use when reviewing security posture or assessing risk before release.",
    content: securityMd,
  },
  {
    name: "simplify",
    description:
      "Simplify code by reducing complexity while preserving exact behavior. Use after a feature is working, during review when complexity is flagged, or when encountering unclear code.",
    content: simplifyMd,
  },
  {
    name: "style",
    description: "Review code style, naming, patterns, and consistency. Use when reviewing code quality or style drift.",
    content: styleMd,
  },
  {
    name: "tdd",
    description: "Drive implementation with red-green-refactor. Use when building or fixing behavior through tests first.",
    content: tddMd,
  },
  {
    name: "tests",
    description:
      "Review test coverage, quality, and missing edge cases. Use when reviewing whether changed code has adequate tests.",
    content: testsMd,
  },
];
