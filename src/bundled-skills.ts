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
  content: string;
}

export const BUNDLED_SKILLS: readonly BundledSkill[] = [
  { name: "architecture", content: architectureMd },
  { name: "build", content: buildMd },
  { name: "debug", content: debugMd },
  { name: "deprecation", content: deprecationMd },
  { name: "design", content: designMd },
  { name: "docs", content: docsMd },
  { name: "explore", content: exploreMd },
  { name: "git", content: gitMd },
  { name: "plan", content: planMd },
  { name: "review", content: reviewMd },
  { name: "security", content: securityMd },
  { name: "simplify", content: simplifyMd },
  { name: "style", content: styleMd },
  { name: "tdd", content: tddMd },
  { name: "tests", content: testsMd },
];
