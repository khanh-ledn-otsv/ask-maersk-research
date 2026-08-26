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
- `screenshots/01-start.png`, one result screenshot per completed answer, and exceptional-state screenshots
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

A case declares an ID, category, objective, authentication requirement, execution mode, one or more ordered messages, trace preference, and optional notes. Invalid files and duplicate IDs are reported before browser capture starts. Automated messages run sequentially in the same browser conversation; manual cases retain every observed submission in order.

```json
{
  "id": "TRACK-001",
  "category": "TRACKING",
  "objective": "Observe clarification when a shipment identifier is missing",
  "authenticated": false,
  "executionMode": "manual",
  "messages": [
    { "text": "Track my shipment" },
    { "text": "Use booking reference ABC123" }
  ],
  "captureTrace": false,
  "notes": "Use fake shipment data only."
}
```

Manual cases keep recording while the researcher controls the persistent browser. Automated cases require a stable question selector and may optionally use a submit selector; without the latter, the recorder presses Enter in the question field:

```bash
ASK_MAERSK_INPUT_SELECTOR='[data-testid="question"]' \
ASK_MAERSK_SUBMIT_SELECTOR='[data-testid="send"]' \
ASK_MAERSK_LOADING_SELECTOR='[role="progressbar"]' \
pnpm research run CAPABILITY-001
```

For each completed automated turn, evidence records submission time, the first observed loading indicator, the first visible response, completion time, a result screenshot, and links, buttons, or suggested questions exposed with the answer. If a later response times out, the run still saves all completed turns and records the failed turn as diagnostic evidence.

Use `RESEARCH_CASES_DIR` to choose another case directory. A case with `captureTrace: true` also writes `trace/trace.zip` and references it from `evidence.json`.

This exploratory recorder stores captured text, screenshots, and network values as observed. Use only public guest flows with fake or otherwise non-sensitive test data, and keep run directories local.

## Analyze a recorded run

Analysis is optional and is the only workflow that requires `OPEN_AI_API_KEY`. It uses the OpenAI Responses API through a provider-neutral analyzer and writes a validated `finding.json` beside the run's `evidence.json`:

```bash
pnpm research analyze data/runs/<run-directory>
```

The default model is `gpt-5.4-mini` with reasoning effort `none`. Select a different model or effort explicitly with flags or environment variables:

```bash
pnpm research analyze data/runs/<run-directory> \
  --model gpt-5-nano \
  --reasoning-effort low
```

Use `RESEARCH_ANALYSIS_MODEL` and `RESEARCH_ANALYSIS_REASONING_EFFORT` for persistent overrides. Supported reasoning efforts are `none`, `low`, `medium`, `high`, and `xhigh`. Analysis makes one request with the selected model and never falls back to another model.

Each finding classifies the observed behavior, lists plausible API candidates, and states Ask ONE implications. Every claim includes references to conversation turns, screenshots, network requests, timings, errors, or page evidence from the same run. Missing and unsupported references fail validation before anything is persisted. The CLI reports the actual model and input, cached-input, output, and reasoning token counts returned by the API.

## Run the representative corpus

The `cases/` directory contains 21 cases across capability, tracking, schedules, knowledge, conversational context, authentication, and guardrails. Each case declares whether it uses public, deliberately fake, or explicitly authorized test data. Public and deliberately fake cases that declare automated execution can run unattended. Authorized cases stay blocked unless their additional safeguards are satisfied.

Run one case or a whole category and analyze each completed capture:

```bash
pnpm research corpus --case CAPABILITY-001
pnpm research corpus --category KNOWLEDGE
```

Corpus execution uses the same cost-conscious analysis defaults as `research analyze` (`gpt-5.4-mini`, reasoning `none`) and accepts the same `--model` and `--reasoning-effort` overrides. Automated cases without a configured `ASK_MAERSK_INPUT_SELECTOR` remain visible as skipped instead of disappearing.

Every invocation writes a new immutable `data/corpus-runs/<run-id>/summary.json`. The summary keeps deterministic case order; links completed cases to `evidence.json` and `finding.json`; retains failures and skips; and totals input, cached-input, output, and reasoning tokens. A partial run can be resumed without overwriting it:

```bash
pnpm research corpus --category KNOWLEDGE \
  --resume data/corpus-runs/<previous-run-id>/summary.json
```

Resume creates another immutable summary, reuses completed case results, and retries failed or skipped cases. The selection and model policy must match the prior summary. Use `RESEARCH_CORPUS_OUTPUT_DIR` or `--summary-output` to move summaries, and the existing `RESEARCH_OUTPUT_DIR` or `--output` setting to move evidence runs.

To capture the complete corpus without an API key or any model cost, run:

```bash
pnpm research preflight --all
pnpm research corpus --all --capture-only
```

Preflight opens the configured page in headed mode, validates the URL, browser authentication state, input and optional submit controls, and assistant/loading selector syntax, but never fills or submits a prompt. It reports `preflight-ready` or an actionable `preflight-required` reason for every selected case and saves `.research/preflight.json` by default.

Capture-only summaries record `captured`, `capture-failed`, `skipped`, and `preflight-required` cases without analysis policy, token usage, or invented finding paths. Every eligible public or fake-data case runs without terminal input. Multi-turn messages for one case share its conversation; each separate case gets a fresh browser context. Cases that still declare manual setup remain visible as `preflight-required`. The CLI prints a concrete existing `research analyze` command for every captured case, but never runs one automatically.

Headless capture is deliberately a second step: first complete a matching headed preflight, then set `RESEARCH_HEADLESS=true` and run the capture command. A missing or mismatched receipt prevents Chromium from launching.

Authorized-data automation needs both an explicit flag and a local JSON file containing every placeholder declared by the selected case:

```json
{
  "APPROVED_SHIPMENT_ID": "value-from-the-approved-test-account"
}
```

```bash
pnpm research preflight --all --allow-authorized-data --test-data .research/approved-test-data.json
pnpm research corpus --all --capture-only --allow-authorized-data --test-data .research/approved-test-data.json
```

Never place production customer identifiers in that file. Public and fake-data cases do not read configured test-data values.

Resume capture into a new immutable summary with the same selection:

```bash
pnpm research corpus --all --capture-only \
  --resume data/corpus-runs/<previous-capture-id>/summary.json
```

## Generate the manager-ready report

Turn a corpus summary into a concise, evidence-linked Markdown report:

```bash
pnpm research report data/corpus-runs/<run-id>/summary.json
```

The default output is `reports/maersk-research.md`. Use `--output <path>` or `RESEARCH_REPORT_PATH` to choose another file. Report generation is offline and does not require an API key. It includes the capability map, representative journeys, primary evidence matrix, architecture patterns, strengths and weaknesses, Ask ONE implications, selected screenshot and network examples, model/token usage, and explicit evidence gaps. Existing report files are not overwritten.

## Verify

```bash
pnpm typecheck
pnpm test
```
