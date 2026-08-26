# 11: Provide the one-command operator workflow

**What to build:** Give the researcher one unattended collection command that preflights, captures the full eligible corpus, retries recoverable failures, resumes safely, and then stops at the paid-analysis boundary. After explicit analysis approval, the existing offline report generator should produce the manager-ready report from the analyzed summary.

**Blocked by:** 07: Generate the manager-ready research report; 09: Run the safe corpus unattended; 10: Add cost-gated corpus analysis.

**Status:** ready-for-agent

- [ ] One documented command runs preflight plus full capture and never invokes AI.
- [ ] Recoverable browser failures use bounded retries; interrupted runs resume into a new immutable summary without repeating successful cases.
- [ ] The command exits with a concise completion table covering captured, failed, safely skipped, and preflight-required cases.
- [ ] On completion it prints, but does not execute, the exact cost-gated analysis command and subsequent offline report command.
- [ ] After approved analysis, `pnpm research report <analyzed-summary>` produces one cross-category manager report.
- [ ] Logs and summaries never contain API keys, browser credentials, or unredacted configured test identifiers beyond evidence explicitly approved for capture.
- [ ] README documentation provides a copy-paste path for headed collection, resumable collection, approved analysis, and offline report generation.
- [ ] An integration test exercises the complete orchestration with fake browser and analyzer adapters, including interruption, resume, cost refusal, approval, and final report creation.
