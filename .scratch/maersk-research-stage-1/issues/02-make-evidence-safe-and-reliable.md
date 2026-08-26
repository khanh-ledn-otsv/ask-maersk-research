# 02: Make recorded evidence diagnostically reliable

**What to build:** Make manual research recordings trustworthy enough to inspect. Functionally relevant requests and responses should be correlated and easy to distinguish from noise, while diagnostic information remains available when the browser encounters failure or unusual UI states.

**Blocked by:** 01: Record one complete manual Ask Maersk interaction.

**Status:** ready-for-agent

- [ ] Requests, responses, failures, status codes, bodies, and durations are correlated into coherent network evidence.
- [ ] Functional traffic such as XHR, fetch, GraphQL, SSE, WebSocket, and POST activity is prioritized while static assets and telemetry are excluded from interesting evidence.
- [ ] Errors, login walls, modals, and unexpected states trigger additional screenshots and recorded errors without losing the rest of the run.
- [ ] Tests verify useful traffic is retained while known noise is filtered and failures preserve diagnostic evidence.
