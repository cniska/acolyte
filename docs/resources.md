# Resources

External references and research links relevant to Acolyte design decisions.

## Papers and Research
### How to Write Better AGENTS.md? (arXiv, February 2026)
https://arxiv.org/abs/2602.11988

This paper evaluates coding agents across SWE-bench and a new benchmark built from repositories with developer-committed agent context files. The main result is that LLM-generated repository context files tend to slightly reduce success rates while increasing inference cost and step count. The behavioral analysis shows that agents generally follow these instructions, which often leads to broader exploration and extra testing effort. The practical takeaway for this project is to keep repository instructions minimal, concrete, and required-only, and to prefer runtime guardrails over prompt-heavy policy text.
