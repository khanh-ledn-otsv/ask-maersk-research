# 09: Run the safe corpus unattended

**What to build:** Make every safely automatable public or fake-data case run without terminal interaction. Add a preflight that validates the browser session, selectors, case inputs, and data policy before launching a long run. Authorized-data cases may run unattended only when the researcher explicitly opts in and supplies approved test inputs; otherwise they remain visible as requiring human setup.

**Blocked by:** 08: Separate corpus capture from paid analysis.

**Status:** completed

- [x] A preflight command checks the Ask Maersk URL, browser authentication state where required, input/submit/assistant/loading selectors, and required test-data placeholders without submitting a research prompt.
- [x] `pnpm research corpus --all --capture-only` performs no terminal reads and completes every eligible case unattended.
- [x] Public and fake-data cases never consume live customer identifiers; authorized-data automation requires an explicit flag plus configured approved test values.
- [x] Missing authentication, selectors, or approved test inputs produce actionable per-case `preflight-required` results instead of hanging or silently disappearing.
- [x] Automated cases reuse the intended conversation session only where the case declares multi-turn context, while separate cases remain isolated.
- [x] Headed mode remains available for observation, and headless mode is opt-in only after preflight succeeds.
- [x] Tests cover selector failure, missing test data, auth-required cases, no-prompt execution, case isolation, and a fully unattended happy path without live Maersk access.
