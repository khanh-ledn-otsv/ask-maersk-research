# 07: Generate the manager-ready research report

**What to build:** Turn a completed research run into a concise Markdown report that explains what Ask Maersk can do, representative journeys, observable architecture patterns, strengths and weaknesses, and concrete implications for Ask ONE. The report should be traceable to evidence and provide enough material for two or three manager slides without turning the spike into a presentation platform.

**Blocked by:** 06: Build and run the representative research corpus.

**Status:** completed

- [x] The report contains a capability map, representative user journeys, observed architecture patterns, strengths and weaknesses, and Ask ONE implications.
- [x] A primary matrix connects each case’s observation, evidence, architecture inference, and Ask ONE implication.
- [x] Every reported factual observation links to captured evidence, and unsupported findings are omitted or explicitly marked uncertain.
- [x] The report summarizes model usage and analysis cost.
- [x] The output highlights the strongest 8–12 screenshots, 2–3 useful network/API examples, and 5–10 concrete Ask ONE lessons when the corpus contains them.
- [x] Tests verify deterministic report structure, escaping, missing evidence handling, and useful output from partial runs.

## Comments

- 2026-08-26: Added the offline `research report` CLI workflow, deterministic manager-ready Markdown synthesis, evidence-linked matrices and ranked highlights, uncertainty handling, actual model/token-cost reporting, and partial-run degradation. The final review separated loading, rendering, and writing; typecheck and all 50 tests pass.
