# 02: Make recorded evidence safe and diagnostically reliable

**What to build:** Make manual research recordings trustworthy enough to inspect and share. Functionally relevant requests and responses should be correlated and easy to distinguish from noise, while diagnostic information remains available. Authentication secrets and customer-specific values must never appear in persisted evidence, including when the browser encounters failure or unusual UI states.

**Blocked by:** 01: Record one complete manual Ask Maersk interaction.

**Status:** ready-for-agent

- [ ] Requests, responses, failures, status codes, bodies, and durations are correlated into coherent network evidence.
- [ ] Functional traffic such as XHR, fetch, GraphQL, SSE, WebSocket, and POST activity is prioritized while static assets and telemetry are excluded from interesting evidence.
- [ ] Authorization, cookies, API keys, tokens, sessions, CSRF values, passwords, secrets, and configured customer identifiers are redacted before persistence.
- [ ] Errors, login walls, modals, and unexpected states trigger additional screenshots and recorded errors without losing the rest of the run.
- [ ] Tests prove representative secrets cannot appear in persisted evidence and verify useful traffic is retained while known noise is filtered.
