# 08: Separate corpus capture from paid analysis

**What to build:** Let the researcher capture a corpus without an OpenAI key or any model calls. Capture summaries should represent evidence readiness independently from finding readiness so browser automation can finish before the researcher chooses whether to incur analysis cost.

**Blocked by:** 06: Build and run the representative research corpus.

**Status:** ready-for-agent

- [ ] `pnpm research corpus --all --capture-only` selects the complete case corpus in deterministic order and does not require `OPEN_AI_API_KEY`.
- [ ] Capture-only execution never creates an analyzer, invokes a model, or writes a fabricated `findingPath`.
- [ ] The immutable corpus summary distinguishes captured evidence, capture failure, safe skip, and manual/preflight-required cases.
- [ ] Existing analyzed corpus summaries remain readable, and the current per-case/per-category workflow remains backward compatible.
- [ ] Capture-only output tells the researcher exactly which paid analysis command can be run next.
- [ ] Tests prove complete selection, zero model calls, partial capture visibility, resumability, and backward-compatible summary loading.
