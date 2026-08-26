# 04: Capture multi-turn research journeys

**What to build:** Allow a research case to exercise follow-up questions and context changes as one coherent journey. Each turn should preserve what the researcher and Ask Maersk exchanged, when visible response stages occurred, what the interface offered, and what the page looked like after the answer completed.

**Blocked by:** 03: Run one declarative research case.

**Status:** ready-for-agent

- [ ] Declared messages run sequentially in the same browser conversation and preserve their order in evidence.
- [ ] Each turn records submission, first loading indicator, first visible response, and completed response timing when those signals are observable.
- [ ] Each completed answer has a presentation-quality screenshot, with a start screenshot and additional exceptional-state screenshots retained.
- [ ] Links, buttons, and suggested questions exposed by assistant responses are captured without attempting to model every UI component.
- [ ] Tests demonstrate follow-up context, context switching, timeouts, and partial failure while preserving all evidence captured before failure.
