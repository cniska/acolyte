# Resources

## Papers and Research
- "How to Write Better AGENTS.md?" (arXiv, February 2026): https://arxiv.org/abs/2602.11988
  - Scope: evaluates coding agents across SWE-bench and a new benchmark from repositories with developer-committed agent context files.
  - Main finding: LLM-generated repository context files tend to reduce success rates slightly and increase inference cost/steps.
  - Behavioral finding: agents generally follow those instructions, which often increases exploration/testing effort.
  - Practical takeaway for this project: keep repository instructions minimal, concrete, and required-only; move enforcement into runtime guards where possible.
