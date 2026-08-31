import { join } from "node:path";
import type {
  BrowserCapture,
  CaseEvidence,
  ScreenshotEvidence,
} from "../domain/evidence.ts";
import { persistRun } from "../persistence/run-store.ts";

export interface BrowserRecorder {
  capture(input: BrowserRecordingInput): Promise<BrowserCapture>;
}

export interface BrowserRecordingInput {
  readonly captureTrace?: boolean;
  readonly expectedUserMessages: readonly string[];
  readonly interaction?: BrowserInteraction;
  readonly isolateSession?: boolean;
  readonly targetUrl: string;
  readonly waitForCompletion: () => Promise<void>;
}

export type BrowserInteraction =
  | { readonly mode: "manual" }
  | {
      readonly inputSelector?: string;
      readonly mode: "automated";
      readonly submitSelector?: string;
    };

export interface RecordResearchSessionInput {
  readonly captureTrace?: boolean;
  readonly caseId?: string;
  readonly interaction?: BrowserInteraction;
  readonly isolateSession?: boolean;
  readonly outputRoot: string;
  readonly targetUrl: string;
  readonly userMessages: readonly string[];
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
    ...(typeof input.captureTrace === "undefined"
      ? {}
      : { captureTrace: input.captureTrace }),
    expectedUserMessages: input.userMessages,
    ...(typeof input.interaction === "undefined" ? {} : { interaction: input.interaction }),
    ...(input.isolateSession === true ? { isolateSession: true } : {}),
    targetUrl: input.targetUrl,
    waitForCompletion: input.waitForCompletion,
  });
  const evidence = buildEvidence(
    runId,
    startedAt,
    dependencies.now().toISOString(),
    capture,
    input.caseId,
  );

  await persistRun({
    evidence,
    runDirectory,
    screenshots: capture.screenshots,
    ...(typeof capture.trace === "undefined" ? {} : { trace: capture.trace }),
  });
  return { runId, runDirectory };
}

function buildEvidence(
  runId: string,
  startedAt: string,
  completedAt: string,
  capture: BrowserCapture,
  caseId: string | undefined,
): Omit<CaseEvidence, "trace"> {
  return {
    ...(typeof caseId === "undefined" ? {} : { caseId }),
    runId,
    startedAt,
    completedAt,
    conversation: capture.conversation,
    screenshots: capture.screenshots.map(toScreenshotEvidence),
    network: capture.network,
    timings: capture.timings.map((timing) => ({ ...timing })),
    page: capture.page,
    errors: capture.errors,
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
