import { join } from "node:path";
import type {
  BrowserCapture,
  CaseEvidence,
  ScreenshotEvidence,
} from "../domain/evidence.ts";
import { persistRun } from "../persistence/run-store.ts";
import {
  redactConversationTurn,
  redactNetworkEvidence,
  redactRecordedError,
  redactText,
  redactUrl,
} from "../security/redaction.ts";

export interface BrowserRecorder {
  capture(input: BrowserRecordingInput): Promise<BrowserCapture>;
}

export interface BrowserRecordingInput {
  readonly expectedUserMessage: string;
  readonly sensitiveValues?: readonly string[];
  readonly targetUrl: string;
  readonly waitForCompletion: () => Promise<void>;
}

export interface RecordResearchSessionInput {
  readonly outputRoot: string;
  readonly sensitiveValues?: readonly string[];
  readonly targetUrl: string;
  readonly userMessage: string;
  readonly waitForCompletion: () => Promise<void>;
}

export interface RecordingDependencies {
  readonly browser: BrowserRecorder;
  readonly createRunId: () => string;
  readonly now: () => Date;
}

export interface RecordedResearchSession {
  readonly runId: string;
  readonly runDirectory: string;
}

export async function recordResearchSession(
  input: RecordResearchSessionInput,
  dependencies: RecordingDependencies,
): Promise<RecordedResearchSession> {
  const startedAt = dependencies.now().toISOString();
  const runId = `${formatRunTimestamp(startedAt)}_${dependencies.createRunId()}`;
  const runDirectory = join(input.outputRoot, runId);
  const capture = await dependencies.browser.capture({
    expectedUserMessage: input.userMessage,
    sensitiveValues: input.sensitiveValues ?? [],
    targetUrl: input.targetUrl,
    waitForCompletion: input.waitForCompletion,
  });
  const evidence = buildEvidence(
    runId,
    startedAt,
    dependencies.now().toISOString(),
    capture,
    input.sensitiveValues ?? [],
  );

  await persistRun({ evidence, runDirectory, screenshots: capture.screenshots });
  return { runId, runDirectory };
}

function buildEvidence(
  runId: string,
  startedAt: string,
  completedAt: string,
  capture: BrowserCapture,
  sensitiveValues: readonly string[],
): CaseEvidence {
  return {
    runId,
    startedAt,
    completedAt,
    conversation: capture.conversation.map((turn) => redactConversationTurn(turn, sensitiveValues)),
    screenshots: capture.screenshots.map(toScreenshotEvidence),
    network: capture.network.map((entry) => redactNetworkEvidence(entry, sensitiveValues)),
    timings: { ...capture.timings },
    page: {
      url: redactUrl(capture.page.url, sensitiveValues),
      title: redactText(capture.page.title, sensitiveValues),
    },
    errors: capture.errors.map((error) => redactRecordedError(error, sensitiveValues)),
  };
}

function toScreenshotEvidence(
  screenshot: BrowserCapture["screenshots"][number],
): ScreenshotEvidence {
  return { path: `screenshots/${screenshot.filename}`, kind: screenshot.kind };
}

function formatRunTimestamp(isoTimestamp: string): string {
  return isoTimestamp.slice(0, 19).replace("T", "_").replaceAll(":", "");
}
