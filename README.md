# Ask Maersk Research

A local TypeScript CLI for capturing evidence from a researcher-controlled Ask Maersk browser session. Evidence capture does not use AI and does not require an OpenAI API key.

## Requirements

- Node.js 24
- pnpm 10
- Playwright Chromium

## Setup

```bash
pnpm install
pnpm exec playwright install chromium
cp .env.example .env
```

Set `ASK_MAERSK_URL` in `.env` to the page you are authorized to research. The browser profile is persistent across sessions so authentication can be completed manually.

## Record a session

```bash
pnpm research record
```

The browser opens at the configured URL. Ask “Track my shipment,” wait for the answer to finish, return to the terminal, and press Enter. The recorder observes form submissions and unmodified Enter-key submissions in the page, captures the final assistant text selected by `ASK_MAERSK_ASSISTANT_SELECTOR`, and writes an immutable run under `data/runs/`. If the observed prompt differs from the expected `--message`, the discrepancy is preserved as a recorded browser error rather than silently inventing a turn.

Each run contains:

- `evidence.json`: the complete evidence record
- `conversation.json`: the known user prompt and captured assistant text
- `metadata.json`: run and page metadata
- `screenshots/01-start.png` and `screenshots/02-result.png`
- `network/requests.jsonl`: correlated functional network evidence

Override the configured URL, output directory, or known prompt when needed:

```bash
pnpm research record --url https://example.test/ask-maersk --output data/runs --message "Track my shipment"
```

## Run a research case

Research cases are strict JSON files in `cases/`. Run one by its declared ID:

```bash
pnpm research run TRACK-001
```

A case declares an ID, category, objective, authentication requirement, execution mode, one message, trace preference, and optional notes. Invalid files and duplicate IDs are reported before browser capture starts. This stage deliberately accepts one message per case; multi-turn journeys are a later capability.

```json
{
  "id": "TRACK-001",
  "category": "TRACKING",
  "objective": "Observe clarification when a shipment identifier is missing",
  "authenticated": false,
  "executionMode": "manual",
  "messages": [{ "text": "Track my shipment" }],
  "captureTrace": false,
  "notes": "Use fake shipment data only."
}
```

Manual cases keep recording while the researcher controls the persistent browser. Automated cases require a stable question selector and may optionally use a submit selector; without the latter, the recorder presses Enter in the question field:

```bash
ASK_MAERSK_INPUT_SELECTOR='[data-testid="question"]' \
ASK_MAERSK_SUBMIT_SELECTOR='[data-testid="send"]' \
pnpm research run CAPABILITY-001
```

Use `RESEARCH_CASES_DIR` to choose another case directory. A case with `captureTrace: true` also writes `trace/trace.zip` and references it from `evidence.json`.

This exploratory recorder stores captured text, screenshots, and network values as observed. Use only public guest flows with fake or otherwise non-sensitive test data, and keep run directories local.

## Verify

```bash
pnpm typecheck
pnpm test
```
