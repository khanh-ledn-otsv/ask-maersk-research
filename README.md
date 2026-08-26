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

This exploratory recorder stores captured text, screenshots, and network values as observed. Use only public guest flows with fake or otherwise non-sensitive test data, and keep run directories local.

## Verify

```bash
pnpm typecheck
pnpm test
```
