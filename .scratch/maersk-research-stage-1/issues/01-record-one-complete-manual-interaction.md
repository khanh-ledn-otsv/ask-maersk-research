# 01: Record one complete manual Ask Maersk interaction

**What to build:** Give a researcher one command that opens Ask Maersk in a persistent browser session, allows a manual “Track my shipment” interaction, and saves a complete, independently useful evidence record. The record must include the conversation, presentation-quality screenshots, relevant network activity, timings, page metadata, and errors, with sensitive values redacted before anything reaches disk.

**Blocked by:** None (can start immediately).

**Status:** completed

- [x] The research command launches persistent Playwright Chromium and leaves control with the researcher for manual interaction.
- [x] One completed interaction produces an immutable run containing conversation turns, screenshots, relevant network activity, timings, page metadata, and recorded errors.
- [x] Sensitive headers, URLs, and bodies are redacted in memory before evidence is persisted.
- [x] The captured evidence remains readable and useful when no OpenAI API key is configured.
- [x] Automated tests cover the externally observable CLI and persistence behaviour without requiring live Ask Maersk access.
