import agentsMd from "../docs/skills/agents-md.md" with { type: "text" };
import architectureReviewMd from "../docs/skills/architecture-review.md" with { type: "text" };
import buildMd from "../docs/skills/build.md" with { type: "text" };
import correctnessReviewMd from "../docs/skills/correctness-review.md" with { type: "text" };
import debugMd from "../docs/skills/debug.md" with { type: "text" };
import deprecationMd from "../docs/skills/deprecation.md" with { type: "text" };
import designMd from "../docs/skills/design.md" with { type: "text" };
import docReviewMd from "../docs/skills/doc-review.md" with { type: "text" };
import gitMd from "../docs/skills/git.md" with { type: "text" };
import planMd from "../docs/skills/plan.md" with { type: "text" };
import reviewMd from "../docs/skills/review.md" with { type: "text" };
import securityReviewMd from "../docs/skills/security-review.md" with { type: "text" };
import simplifyMd from "../docs/skills/simplify.md" with { type: "text" };
import styleReviewMd from "../docs/skills/style-review.md" with { type: "text" };
import tddMd from "../docs/skills/tdd.md" with { type: "text" };
import testReviewMd from "../docs/skills/test-review.md" with { type: "text" };

export interface BundledSkill {
  name: string;
  content: string;
}

export const BUNDLED_SKILLS: readonly BundledSkill[] = [
  { name: "agents-md", content: agentsMd },
  { name: "architecture-review", content: architectureReviewMd },
  { name: "build", content: buildMd },
  { name: "correctness-review", content: correctnessReviewMd },
  { name: "debug", content: debugMd },
  { name: "deprecation", content: deprecationMd },
  { name: "design", content: designMd },
  { name: "doc-review", content: docReviewMd },
  { name: "git", content: gitMd },
  { name: "plan", content: planMd },
  { name: "review", content: reviewMd },
  { name: "security-review", content: securityReviewMd },
  { name: "simplify", content: simplifyMd },
  { name: "style-review", content: styleReviewMd },
  { name: "tdd", content: tddMd },
  { name: "test-review", content: testReviewMd },
];
