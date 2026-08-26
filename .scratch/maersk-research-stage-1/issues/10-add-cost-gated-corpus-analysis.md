# 10: Add cost-gated corpus analysis

**What to build:** Analyze a completed capture summary as a separate, explicit paid operation. Before any model call, show the selected model, the number of cases eligible for analysis, a token estimate or clearly stated estimation limitation, and require deliberate confirmation. Write a new immutable analyzed summary rather than mutating captured evidence.

**Blocked by:** 08: Separate corpus capture from paid analysis.

**Status:** ready-for-agent

- [ ] `pnpm research analyze-corpus <capture-summary>` validates all available evidence and prints a cost preview before making a model call.
- [ ] Interactive use requires confirmation; unattended use requires an explicit `--confirm-cost` flag so a script cannot incur cost accidentally.
- [ ] Declining confirmation makes zero model calls and leaves the capture summary unchanged.
- [ ] Analysis skips already valid findings on resume, keeps failed analyses visible, and writes a new immutable analyzed summary linking evidence and findings.
- [ ] The result reports actual model snapshots and input, cached-input, output, and reasoning tokens returned by the provider.
- [ ] If reliable currency pricing is unavailable, the preview says so and reports token-based cost instead of inventing a monetary estimate.
- [ ] Tests prove the confirmation gate, zero-call decline path, partial analysis, immutable resume, usage aggregation, and compatibility with offline report generation.
