# 05: Turn evidence into a cited structured finding

**What to build:** Let a researcher turn captured case evidence into a validated finding that classifies observed behaviour, identifies plausible API candidates, and states Ask ONE implications. Every claim must point back to captured evidence. Analysis must be inexpensive by default, transparent about usage, and incapable of silently escalating to a premium model.

**Blocked by:** 02: Make recorded evidence diagnostically reliable.

**Status:** completed

- [x] Analysis uses the OpenAI Responses API through a provider-neutral analyzer interface and validates the complete response against the finding schema.
- [x] The default model is `gpt-5.4-mini`; a configured model override permits cheaper evaluation such as `gpt-5-nano`, but there is no automatic Terra or other premium-model fallback.
- [x] The default reasoning effort is cost-conscious and configurable, and each analysis reports its model plus input, cached-input, reasoning/output token usage when returned by the API.
- [x] Findings with missing, unknown, or mismatched evidence references fail validation rather than being persisted as factual results.
- [x] Capture and report workflows remain usable without an API key, while analysis exits clearly when no key is configured.
- [x] Tests use a fake analyzer to cover successful classification, malformed structured output, unsupported evidence references, API errors, and explicit model selection.

## Comments

- 2026-08-26: The user explicitly selected `gpt-5.4-mini` in place of the ticket's original `gpt-5.6-luna` default. The implementation preserves explicit model overrides and has no fallback path.
- 2026-08-26: A live Responses API smoke test used a synthetic, non-sensitive evidence fixture. The returned finding validated successfully and reported the actual model snapshot plus token usage.
