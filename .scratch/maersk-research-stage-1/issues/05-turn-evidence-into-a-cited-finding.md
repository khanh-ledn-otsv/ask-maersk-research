# 05: Turn evidence into a cited structured finding

**What to build:** Let a researcher turn already-redacted case evidence into a validated finding that classifies observed behaviour, identifies plausible API candidates, and states Ask ONE implications. Every claim must point back to captured evidence. Analysis must be inexpensive by default, transparent about usage, and incapable of silently escalating to a premium model.

**Blocked by:** 02: Make recorded evidence safe and diagnostically reliable.

**Status:** ready-for-agent

- [ ] Analysis uses the OpenAI Responses API through a provider-neutral analyzer interface and validates the complete response against the finding schema.
- [ ] The default model is `gpt-5.6-luna`; a configured model override permits cheaper evaluation such as `gpt-5-nano`, but there is no automatic Terra or other premium-model fallback.
- [ ] The default reasoning effort is cost-conscious and configurable, and each analysis reports its model plus input, cached-input, reasoning/output token usage when returned by the API.
- [ ] Findings with missing, unknown, or mismatched evidence references fail validation rather than being persisted as factual results.
- [ ] Capture and report workflows remain usable without an API key, while analysis exits clearly without leaking evidence or credentials.
- [ ] Tests use a fake analyzer to cover successful classification, malformed structured output, unsupported evidence references, API errors, and explicit model selection.
