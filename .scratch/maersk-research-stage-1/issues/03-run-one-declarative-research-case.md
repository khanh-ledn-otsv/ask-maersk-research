# 03: Run one declarative research case

**What to build:** Let a researcher describe a question as validated data and run it by case ID. The same case format must support both automated interaction and researcher-controlled manual interaction, and both modes must produce the established evidence format.

**Blocked by:** 02: Make recorded evidence safe and diagnostically reliable.

**Status:** ready-for-agent

- [ ] A research case declares its identity, category, objective, authentication requirement, execution mode, messages, trace preference, and optional notes.
- [ ] Invalid or duplicate cases fail before the browser is launched and report actionable validation errors.
- [ ] Running a single case by ID produces evidence conforming to the same contract as a manual recording.
- [ ] Manual execution keeps recording active while the researcher interacts; automated execution submits the declared message when stable selectors are available.
- [ ] Tests exercise valid, invalid, missing, manual, and automated case behaviour without depending on the live site.
