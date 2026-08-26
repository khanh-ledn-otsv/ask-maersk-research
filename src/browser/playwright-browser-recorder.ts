import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  chromium,
  type BrowserContext,
  type Locator,
  type Page,
  type Request,
  type Response,
  type WebSocket as PlaywrightWebSocket,
} from "playwright";
import type {
  BrowserCapture,
  ConversationTurn,
  InterfaceOfferEvidence,
  NetworkEvidence,
  NetworkFrameEvidence,
  RecordedError,
  ScreenshotCapture,
  TimingEvidence,
  TraceCapture,
} from "../domain/evidence.ts";
import type { BrowserPreflight } from "./browser-preflight.ts";
import type {
  BrowserRecorder,
  BrowserRecordingInput,
} from "../recording/record-research-session.ts";

const FUNCTIONAL_RESOURCE_TYPES = new Set(["eventsource", "fetch", "xhr"]);
const TELEMETRY_DOMAINS = [
  "amplitude.com",
  "clarity.ms",
  "datadoghq.com",
  "google-analytics.com",
  "hotjar.com",
  "mixpanel.com",
  "newrelic.com",
  "segment.io",
  "sentry.io",
];
const TELEMETRY_PATH = /\/telemetry(?:\/|$)/iu;
const EVENT_SOURCE_BINDING = "__askMaerskResearchRecordEventSourceMessage";
const SUBMISSION_BINDING = "__askMaerskResearchRecordSubmission";
const DEFAULT_LOADING_SELECTOR =
  '[aria-busy="true"], [role="progressbar"], [data-testid*="loading" i], [class*="loading" i]';

export interface PlaywrightBrowserRecorderOptions {
  readonly assistantSelector?: string;
  readonly headless?: boolean;
  readonly loadingSelector?: string;
  readonly now?: () => Date;
  readonly responseTimeoutMs?: number;
  readonly resultSelector?: string;
  readonly userDataDirectory: string;
}

interface NetworkDraft {
  id: string;
  timestamp: string;
  method: string;
  url: string;
  resourceType: string;
  requestHeaders?: Readonly<Record<string, string>>;
  requestBody?: unknown;
  responseHeaders?: Readonly<Record<string, string>>;
  responseBody?: unknown;
  status?: number;
  durationMs?: number;
  failure?: string;
  frames?: NetworkFrameEvidence[];
  settled: boolean;
  startedAtMs: number;
}

interface UserSubmission {
  readonly text: string;
  readonly timestamp: string;
}

interface NetworkCaptureResult {
  readonly errors: readonly RecordedError[];
  readonly network: readonly NetworkEvidence[];
}

interface AssistantObservation {
  readonly interfaceOffers: readonly InterfaceOfferEvidence[];
  readonly text: string;
}

interface JourneyCapture {
  readonly conversation: readonly ConversationTurn[];
  readonly errors: readonly RecordedError[];
  readonly screenshots: readonly ScreenshotCapture[];
  readonly timings: readonly TimingEvidence[];
}

interface LoadingIndicatorObservation {
  readonly finished: Promise<void>;
  readonly observedAt: () => Date | undefined;
}

interface LiveManualTurn {
  firstVisibleAt?: Date;
  loadingAt?: Date;
  observation?: AssistantObservation;
  readonly previousAssistantCount: number;
  readonly previousAssistantObservation?: AssistantObservation;
  readonly submission: UserSubmission;
  readonly turnIndex: number;
}

interface EventSourceObservation {
  readonly connectionId: string;
  readonly data: string;
  readonly eventName: string;
  readonly generation: number;
  readonly kind: "message" | "open";
  readonly timestamp: string;
  readonly url: string;
}

type BodyParseResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly error: string; readonly ok: false; readonly value: string };

export function createPlaywrightBrowserRecorder(
  options: PlaywrightBrowserRecorderOptions,
): BrowserRecorder & BrowserPreflight {
  const now = options.now ?? (() => new Date());
  const assistantSelector =
    options.assistantSelector ??
    '.mc-c-ask-maersk, [data-message-author-role="assistant"], [data-role="assistant"], [data-testid*="assistant"], main';
  const resultSelector = options.resultSelector ?? ".mc-c-ask-maersk";
  return {
    async capture(input) {
      return captureWithPlaywright(input, {
        assistantSelector,
        headless: options.headless ?? false,
        loadingSelector: options.loadingSelector ?? DEFAULT_LOADING_SELECTOR,
        now,
        responseTimeoutMs: options.responseTimeoutMs ?? 30_000,
        resultSelector,
        userDataDirectory: options.userDataDirectory,
      });
    },
    async preflight(input) {
      const context = await chromium.launchPersistentContext(options.userDataDirectory, {
        headless: options.headless ?? false,
        viewport: { width: 1_440, height: 1_000 },
      });
      try {
        const page = context.pages()[0] ?? (await context.newPage());
        await page.goto(input.targetUrl, { waitUntil: "domcontentloaded" });
        const issues: string[] = [];
        if (page.url() !== input.targetUrl) {
          issues.push(`Ask Maersk URL redirected from "${input.targetUrl}" to "${page.url()}".`);
        }
        await checkVisibleSelector(page, input.inputSelector, "Input", issues);
        if (typeof input.submitSelector !== "undefined") {
          await checkVisibleSelector(page, input.submitSelector, "Submit", issues);
        }
        await checkSelectorMatch(page, assistantSelector, "Assistant", issues);
        await checkSelectorMatch(
          page,
          options.loadingSelector ?? DEFAULT_LOADING_SELECTOR,
          "Loading",
          issues,
        );
        const loginWall = await hasVisibleMatch(
          page.locator(
            'input[type="password"], form[action*="login" i], [data-testid*="login" i], [data-testid*="signin" i]',
          ),
        );
        return { authenticated: !loginWall, issues, pageUrl: page.url() };
      } finally {
        await context.close();
      }
    },
  };
}

async function checkVisibleSelector(
  page: Page,
  selector: string,
  label: string,
  issues: string[],
): Promise<void> {
  try {
    if (!(await hasVisibleMatch(page.locator(selector)))) {
      issues.push(`${label} selector "${selector}" did not match a visible element.`);
    }
  } catch (error: unknown) {
    issues.push(`${label} selector "${selector}" is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function checkSelectorMatch(
  page: Page,
  selector: string,
  label: string,
  issues: string[],
): Promise<void> {
  try {
    if ((await page.locator(selector).count()) === 0) {
      issues.push(`${label} selector "${selector}" did not match an element.`);
    }
  } catch (error: unknown) {
    issues.push(`${label} selector "${selector}" is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

interface ResolvedOptions {
  readonly assistantSelector: string;
  readonly headless: boolean;
  readonly loadingSelector: string;
  readonly now: () => Date;
  readonly responseTimeoutMs: number;
  readonly resultSelector: string;
  readonly userDataDirectory: string;
}

async function captureWithPlaywright(
  input: BrowserRecordingInput,
  options: ResolvedOptions,
): Promise<BrowserCapture> {
  const isolatedProfile = input.isolateSession === true
    ? await createIsolatedProfile(options.userDataDirectory)
    : undefined;
  const context = await chromium.launchPersistentContext(
    isolatedProfile?.profilePath ?? options.userDataDirectory,
    {
    headless: options.headless,
    viewport: { width: 1_440, height: 1_000 },
    },
  );
  let traceStarted = false;
  if (input.captureTrace === true) {
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    traceStarted = true;
  }
  const page = context.pages()[0] ?? (await context.newPage());
  const interaction = await startInteractionCapture(page, options.now);
  const pageErrors = startBrowserErrorCapture(context, options.now, (errorPage) =>
    takeScreenshot(errorPage),
  );
  const eventSourceObservations = await startEventSourceCapture(context, options.now);
  const networkCapture = startNetworkCapture(context, options.now, eventSourceObservations);

  try {
    await page.goto(input.targetUrl, { waitUntil: "domcontentloaded" });
    const recordingStartedAt = options.now();
    const startScreenshot = await takeScreenshot(page);

    const liveJourney = await executeInteraction(
      page,
      input,
      options,
      interaction.submissions,
    );

    const completedAt = options.now();
    const resultPage = await findResultPage(context.pages(), page, options.resultSelector);
    await resultPage.bringToFront();
    const needsManualSnapshot =
      typeof liveJourney === "undefined" ||
      (input.interaction?.mode !== "automated" && liveJourney.screenshots.length === 0);
    const journey = needsManualSnapshot
      ? await captureManualJourney(
          resultPage,
          interaction.submissions(),
          completedAt,
          recordingStartedAt,
          options.assistantSelector,
        )
      : liveJourney;
    const exceptionalStates = await inspectExceptionalStates(
      resultPage,
      options.assistantSelector,
      completedAt,
    );
    const network = await networkCapture.finish();
    const lateErrors = [
      ...network.errors,
      ...interaction.errors(),
      ...journey.errors,
      ...exceptionalStates,
      ...validateExpectedMessages(
        input.expectedUserMessages,
        interaction.submissions(),
        completedAt,
      ),
    ];
    const errors = [
      ...pageErrors.errors(),
      ...lateErrors,
    ].toSorted((left, right) => left.timestamp.localeCompare(right.timestamp));
    const eventScreenshots = await pageErrors.screenshots();
    const lateScreenshots = await captureRepeatedScreenshots(resultPage, lateErrors.length);
    const baseScreenshots: readonly ScreenshotCapture[] = [
      { filename: "01-start.png", kind: "start", data: startScreenshot },
      ...journey.screenshots,
    ];
    const diagnosticScreenshots = [...eventScreenshots, ...lateScreenshots].map(
      (data, index) => ({
        filename: `${String(index + baseScreenshots.length + 1).padStart(2, "0")}-error.png`,
        kind: "error" as const,
        data,
      }),
    );
    const trace = traceStarted ? await finishTrace(context) : undefined;
    traceStarted = false;

    return {
      page: { url: resultPage.url(), title: await resultPage.title() },
      conversation: journey.conversation,
      screenshots: [...baseScreenshots, ...diagnosticScreenshots],
      network: network.network,
      timings: journey.timings,
      errors,
      ...(typeof trace === "undefined" ? {} : { trace }),
    };
  } finally {
    if (traceStarted) await context.tracing.stop().catch(() => undefined);
    await context.close();
    if (typeof isolatedProfile !== "undefined") {
      await rm(isolatedProfile.root, { force: true, recursive: true });
    }
  }
}

async function createIsolatedProfile(
  source: string,
): Promise<{ readonly profilePath: string; readonly root: string }> {
  const root = await mkdtemp(join(tmpdir(), "ask-maersk-profile-"));
  const profilePath = join(root, "profile");
  try {
    await cp(source, profilePath, { recursive: true });
  } catch (error: unknown) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    await mkdir(profilePath);
  }
  return { profilePath, root };
}

async function finishTrace(context: BrowserContext): Promise<TraceCapture> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "ask-maersk-trace-"));
  const path = join(temporaryDirectory, "trace.zip");
  try {
    await context.tracing.stop({ path });
    return { filename: "trace.zip", data: await readFile(path) };
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}

async function executeInteraction(
  page: Page,
  input: BrowserRecordingInput,
  options: ResolvedOptions,
  submissions: () => readonly UserSubmission[],
): Promise<JourneyCapture | undefined> {
  if (input.interaction?.mode !== "automated") {
    const journey = await captureLiveManualJourney(
      page,
      input.waitForCompletion,
      submissions,
      input.expectedUserMessages.length,
      options,
    );
    return journey.conversation.length === 0 ? undefined : journey;
  }

  const question = page.locator(input.interaction.inputSelector);
  await question.waitFor({ state: "visible" });
  const conversation: ConversationTurn[] = [];
  const errors: RecordedError[] = [];
  const screenshots: ScreenshotCapture[] = [];
  const timings: TimingEvidence[] = [];

  for (const [turnIndex, message] of input.expectedUserMessages.entries()) {
    const assistants = page.locator(options.assistantSelector);
    const previousCount = await assistants.count();
    const previousText = previousCount === 0 ? "" : await readAssistantText(page, options.assistantSelector);
    await question.fill(message);
    const submittedAt = options.now();
    const loadingObservation = startLoadingIndicatorObservation(
      page,
      options.loadingSelector,
      options.now,
      options.responseTimeoutMs,
    );
    if (typeof input.interaction.submitSelector === "undefined") {
      await question.press("Enter");
    } else {
      await page.locator(input.interaction.submitSelector).click();
    }
    appendUserTurn(conversation, message, submittedAt.toISOString());

    const timing: TimingEvidence = {
      turnIndex,
      submittedAt: submittedAt.toISOString(),
    };
    let firstVisibleAt: Date | undefined;
    try {
      await page.waitForFunction(
        ({ previousCount: countBefore, previousText: textBefore, selector }) => {
          const elements = Array.from(document.querySelectorAll(selector));
          const latest = elements.at(-1);
          const text = latest?.textContent?.trim() ?? "";
          return text.length > 0 && (elements.length > countBefore || text !== textBefore);
        },
        { previousCount, previousText, selector: options.assistantSelector },
        { timeout: options.responseTimeoutMs },
      );
      firstVisibleAt = options.now();
      const assistant = page.locator(options.assistantSelector).last();
      await Promise.race([loadingObservation.finished, page.waitForTimeout(50)]);
      if (
        input.expectedUserMessages.length > 1 &&
        typeof loadingObservation.observedAt() === "undefined"
      ) {
        await loadingObservation.finished;
      }
      if (
        typeof loadingObservation.observedAt() !== "undefined" ||
        (await hasVisibleMatch(page.locator(options.loadingSelector)))
      ) {
        await waitForNoVisibleMatch(
          page,
          options.loadingSelector,
          options.responseTimeoutMs,
        );
      } else if (input.expectedUserMessages.length > 1) {
        throw new Error("No observable response completion signal appeared");
      }
      await waitForStableText(assistant);
      const completedAt = options.now();
      await Promise.race([loadingObservation.finished, page.waitForTimeout(0)]);
      const loadingAt = loadingObservation.observedAt();
      const observation = await readAssistantObservation(assistant);
      await appendCompletedAssistantTurn({
        completedAt,
        conversation,
        observation,
        page,
        screenshots,
        turnCount: input.expectedUserMessages.length,
        turnIndex,
      });
      timings.push({
        ...timing,
        ...(typeof loadingAt === "undefined"
          ? {}
          : { firstLoadingIndicatorMs: elapsedMs(submittedAt, loadingAt) }),
        firstVisibleResponseMs: elapsedMs(submittedAt, firstVisibleAt),
        completedResponseMs: elapsedMs(submittedAt, completedAt),
      });
    } catch (error: unknown) {
      await Promise.race([loadingObservation.finished, page.waitForTimeout(0)]);
      const loadingAt = loadingObservation.observedAt();
      timings.push({
        ...timing,
        ...(typeof loadingAt === "undefined"
          ? {}
          : { firstLoadingIndicatorMs: elapsedMs(submittedAt, loadingAt) }),
        ...(typeof firstVisibleAt === "undefined"
          ? {}
          : { firstVisibleResponseMs: elapsedMs(submittedAt, firstVisibleAt) }),
      });
      if (typeof firstVisibleAt !== "undefined") {
        const assistant = page.locator(options.assistantSelector).last();
        if ((await assistant.count()) > 0) {
          const observation = await readAssistantObservation(assistant);
          conversation.push({
            index: conversation.length,
            role: "assistant",
            text: observation.text,
            timestamp: firstVisibleAt.toISOString(),
            ...(observation.interfaceOffers.length === 0
              ? {}
              : { interfaceOffers: observation.interfaceOffers }),
          });
        }
      }
      const detail = error instanceof Error ? error.message : String(error);
      errors.push({
        timestamp: options.now().toISOString(),
        message: `Turn ${turnIndex + 1} did not complete: ${detail}`,
        source: "browser",
      });
      break;
    }
  }

  return { conversation, errors, screenshots, timings };
}

async function captureManualJourney(
  page: Page,
  submissions: readonly UserSubmission[],
  completedAt: Date,
  recordingStartedAt: Date,
  assistantSelector: string,
): Promise<JourneyCapture> {
  const observations = await readAssistantObservations(page, assistantSelector);
  const conversation: ConversationTurn[] = [];
  const screenshots: ScreenshotCapture[] = [];
  const turnCount = Math.max(submissions.length, observations.length, 1);

  for (let turnIndex = 0; turnIndex < turnCount; turnIndex += 1) {
    const submission = submissions[turnIndex];
    if (typeof submission !== "undefined") {
      appendUserTurn(conversation, submission.text, submission.timestamp);
    }
    const observation = observations[turnIndex];
    if (typeof observation === "undefined") continue;
    await appendCompletedAssistantTurn({
      completedAt,
      conversation,
      observation,
      page,
      screenshots,
      turnCount: observations.length,
      turnIndex,
    });
  }

  const timings = submissions.map((submission, turnIndex): TimingEvidence => ({
    turnIndex,
    submittedAt: submission.timestamp,
    ...(turnIndex === submissions.length - 1 && observations.length > turnIndex
      ? { completedResponseMs: elapsedMs(new Date(submission.timestamp), completedAt) }
      : {}),
  }));
  if (timings.length === 0) {
    timings.push({
      turnIndex: 0,
      submittedAt: recordingStartedAt.toISOString(),
      ...(observations.length === 0
        ? {}
        : { completedResponseMs: elapsedMs(recordingStartedAt, completedAt) }),
    });
  }
  return { conversation, errors: [], screenshots, timings };
}

async function captureLiveManualJourney(
  page: Page,
  waitForCompletion: () => Promise<void>,
  readSubmissions: () => readonly UserSubmission[],
  turnCount: number,
  options: ResolvedOptions,
): Promise<JourneyCapture> {
  const conversation: ConversationTurn[] = [];
  const errors: RecordedError[] = [];
  const screenshots: ScreenshotCapture[] = [];
  const timings: TimingEvidence[] = [];
  let active: LiveManualTurn | undefined;
  let processedSubmissions = 0;
  let released = false;
  let releaseError: unknown;
  const release = waitForCompletion().then(
    () => {
      released = true;
    },
    (error: unknown) => {
      releaseError = error;
      released = true;
    },
  );

  const finalize = async (force: boolean): Promise<void> => {
    if (typeof active === "undefined") return;
    const assistants = page.locator(options.assistantSelector);
    const assistantCount = await assistants.count();
    if (typeof active.observation === "undefined" && assistantCount > 0 && force) {
      const observation = await readAssistantObservation(assistants.last());
      if (assistantObservationChanged(active, assistantCount, observation)) {
        active.observation = observation;
      }
    }
    const completedAt = options.now();
    const timing: TimingEvidence = {
      turnIndex: active.turnIndex,
      submittedAt: active.submission.timestamp,
      ...(typeof active.loadingAt === "undefined"
        ? {}
        : {
            firstLoadingIndicatorMs: elapsedMs(
              new Date(active.submission.timestamp),
              active.loadingAt,
            ),
          }),
      ...(typeof active.firstVisibleAt === "undefined"
        ? {}
        : {
            firstVisibleResponseMs: elapsedMs(
              new Date(active.submission.timestamp),
              active.firstVisibleAt,
            ),
          }),
      ...(typeof active.observation === "undefined"
        ? {}
        : {
            completedResponseMs: elapsedMs(
              new Date(active.submission.timestamp),
              completedAt,
            ),
          }),
    };
    timings.push(timing);
    if (typeof active.observation !== "undefined") {
      await appendCompletedAssistantTurn({
        completedAt,
        conversation,
        observation: active.observation,
        page,
        screenshots,
        turnCount,
        turnIndex: active.turnIndex,
      });
    } else if (force) {
      errors.push({
        timestamp: completedAt.toISOString(),
        message: `No assistant response was observed for manual turn ${active.turnIndex + 1}`,
        source: "browser",
      });
    }
    active = undefined;
  };

  while (true) {
    const submissions = readSubmissions();
    while (processedSubmissions < submissions.length) {
      await finalize(true);
      const submission = submissions[processedSubmissions];
      if (typeof submission === "undefined") break;
      const assistants = page.locator(options.assistantSelector);
      const previousAssistantCount = await assistants.count();
      const previousAssistantObservation =
        previousAssistantCount === 0
          ? undefined
          : await readAssistantObservation(assistants.last());
      appendUserTurn(conversation, submission.text, submission.timestamp);
      active = {
        previousAssistantCount,
        ...(typeof previousAssistantObservation === "undefined"
          ? {}
          : { previousAssistantObservation }),
        submission,
        turnIndex: processedSubmissions,
      };
      processedSubmissions += 1;
    }

    if (typeof active !== "undefined") {
      const observedAt = options.now();
      const loadingVisible = await hasVisibleMatch(page.locator(options.loadingSelector));
      if (loadingVisible) active.loadingAt ??= observedAt;
      const assistants = page.locator(options.assistantSelector);
      const assistantCount = await assistants.count();
      if (assistantCount > 0) {
        const observation = await readAssistantObservation(assistants.last());
        if (assistantObservationChanged(active, assistantCount, observation)) {
          active.firstVisibleAt ??= observedAt;
          if (!assistantObservationsEqual(observation, active.observation)) {
            active.observation = observation;
          }
        }
      }
      if (
        typeof active.observation !== "undefined" &&
        typeof active.loadingAt !== "undefined" &&
        !loadingVisible
      ) {
        await finalize(false);
      }
    }
    if (released) break;
    await page.waitForTimeout(50);
  }

  await release;
  await finalize(true);
  if (typeof releaseError !== "undefined") throw releaseError;
  return { conversation, errors, screenshots, timings };
}

function assistantObservationChanged(
  turn: LiveManualTurn,
  assistantCount: number,
  observation: AssistantObservation,
): boolean {
  return (
    (observation.text.length > 0 || observation.interfaceOffers.length > 0) &&
    (assistantCount > turn.previousAssistantCount ||
      !assistantObservationsEqual(observation, turn.previousAssistantObservation))
  );
}

function assistantObservationsEqual(
  left: AssistantObservation,
  right: AssistantObservation | undefined,
): boolean {
  return (
    typeof right !== "undefined" &&
    left.text === right.text &&
    left.interfaceOffers.length === right.interfaceOffers.length &&
    left.interfaceOffers.every((offer, index) => {
      const compared = right.interfaceOffers[index];
      return (
        offer.kind === compared?.kind &&
        offer.text === compared.text &&
        offer.href === compared.href
      );
    })
  );
}

function startLoadingIndicatorObservation(
  page: Page,
  selector: string,
  now: () => Date,
  timeout: number,
): LoadingIndicatorObservation {
  let observedAt: Date | undefined;
  const finished = waitForLoadingVisibility(page, selector, true, timeout)
    .then(() => {
      observedAt = now();
    })
    .catch(() => undefined);
  return { finished, observedAt: () => observedAt };
}

async function waitForNoVisibleMatch(
  page: Page,
  selector: string,
  timeout: number,
): Promise<void> {
  await waitForLoadingVisibility(page, selector, false, timeout);
}

async function waitForLoadingVisibility(
  page: Page,
  selector: string,
  visible: boolean,
  timeout: number,
): Promise<void> {
  const result = await page.waitForFunction(
    ({ loadingSelector, targetVisibility }) => {
      const anyVisible = Array.from(document.querySelectorAll(loadingSelector)).some(
        (element) => {
          const style = getComputedStyle(element);
          return (
            style.visibility !== "hidden" &&
            style.display !== "none" &&
            element.getClientRects().length > 0
          );
        },
      );
      return anyVisible === targetVisibility;
    },
    { loadingSelector: selector, targetVisibility: visible },
    { timeout },
  );
  await result.dispose();
}

function appendUserTurn(
  conversation: ConversationTurn[],
  text: string,
  timestamp: string,
): void {
  conversation.push({
    index: conversation.length,
    role: "user",
    text,
    timestamp,
  });
}

async function appendCompletedAssistantTurn(input: {
  readonly completedAt: Date;
  readonly conversation: ConversationTurn[];
  readonly observation: AssistantObservation;
  readonly page: Page;
  readonly screenshots: ScreenshotCapture[];
  readonly turnCount: number;
  readonly turnIndex: number;
}): Promise<void> {
  const filename = resultScreenshotFilename(input.turnIndex, input.turnCount);
  input.screenshots.push({ filename, kind: "result", data: await takeScreenshot(input.page) });
  input.conversation.push({
    index: input.conversation.length,
    role: "assistant",
    text: input.observation.text,
    timestamp: input.completedAt.toISOString(),
    screenshot: `screenshots/${filename}`,
    ...(input.observation.interfaceOffers.length === 0
      ? {}
      : { interfaceOffers: input.observation.interfaceOffers }),
  });
}

function elapsedMs(start: Date, end: Date): number {
  return Math.max(0, end.getTime() - start.getTime());
}

function resultScreenshotFilename(turnIndex: number, turnCount: number): string {
  const sequence = String(turnIndex + 2).padStart(2, "0");
  return turnCount === 1
    ? `${sequence}-result.png`
    : `${sequence}-turn-${String(turnIndex + 1).padStart(2, "0")}-result.png`;
}

async function waitForStableText(locator: Locator): Promise<void> {
  let previous = (await locator.innerText()).trim();
  let stableReads = 0;
  while (stableReads < 3) {
    await locator.page().waitForTimeout(250);
    const current = (await locator.innerText()).trim();
    if (current === previous) stableReads += 1;
    else stableReads = 0;
    previous = current;
  }
}

async function captureRepeatedScreenshots(
  page: Page,
  count: number,
): Promise<readonly Buffer[]> {
  const screenshots: Buffer[] = [];
  for (let index = 0; index < count; index += 1) {
    screenshots.push(await takeScreenshot(page));
  }
  return screenshots;
}

async function inspectExceptionalStates(
  page: Page,
  assistantSelector: string,
  timestamp: Date,
): Promise<readonly RecordedError[]> {
  const states: RecordedError[] = [];
  const record = (message: string): void => {
    states.push({ timestamp: timestamp.toISOString(), message, source: "browser" });
  };

  if (!(await hasVisibleMatch(page.locator(assistantSelector)))) {
    record("Expected assistant response was not visible");
  }
  if (
    await hasVisibleMatch(
      page.locator(
        'input[type="password"], form[action*="login" i], [data-testid*="login" i], [data-testid*="signin" i]',
      ),
    )
  ) {
    record("Login wall detected");
  }
  if (
    await hasVisibleMatch(page.locator('dialog, [role="dialog"], [aria-modal="true"]'))
  ) {
    record("Visible modal detected");
  }
  return states;
}

async function hasVisibleMatch(locator: Locator): Promise<boolean> {
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    if (await locator.nth(index).isVisible()) return true;
  }
  return false;
}

async function findResultPage(
  pages: readonly Page[],
  fallback: Page,
  resultSelector: string,
): Promise<Page> {
  for (const candidate of pages.toReversed()) {
    if (candidate.isClosed()) continue;
    const results = candidate.locator(resultSelector);
    const count = await results.count();
    for (let index = 0; index < count; index += 1) {
      if (await results.nth(index).isVisible()) return candidate;
    }
  }
  return fallback;
}

function startBrowserErrorCapture(
  context: BrowserContext,
  now: () => Date,
  takeScreenshot: (page: Page) => Promise<Buffer>,
): {
  readonly errors: () => readonly RecordedError[];
  readonly screenshots: () => Promise<readonly Buffer[]>;
} {
  const errors: RecordedError[] = [];
  const screenshotReads: Promise<Buffer | undefined>[] = [];
  const captureScreenshot = (page: Page): void => {
    screenshotReads.push(takeScreenshot(page).catch(() => undefined));
  };
  const observe = (page: Page): void => {
    page.on("pageerror", (error) => {
      errors.push({ timestamp: now().toISOString(), message: error.message, source: "page" });
      captureScreenshot(page);
    });
    page.on("crash", () => {
      errors.push({ timestamp: now().toISOString(), message: "Page crashed", source: "browser" });
      captureScreenshot(page);
    });
    page.on("dialog", (dialog) => {
      errors.push({
        timestamp: now().toISOString(),
        message: `Browser ${dialog.type()} dialog detected: ${dialog.message()}`,
        source: "browser",
      });
      void dialog
        .dismiss()
        .then(() => captureScreenshot(page))
        .catch(() => undefined);
    });
  };
  observeContextPages(context, observe);
  return {
    errors: () => errors,
    async screenshots() {
      const screenshots = await Promise.all(screenshotReads);
      return screenshots.filter((screenshot): screenshot is Buffer => screenshot !== undefined);
    },
  };
}

function observeContextPages(context: BrowserContext, observe: (page: Page) => void): void {
  const observedPages = new WeakSet<Page>();
  const observeOnce = (page: Page): void => {
    if (observedPages.has(page)) return;
    observedPages.add(page);
    observe(page);
  };
  for (const page of context.pages()) observeOnce(page);
  context.on("page", observeOnce);
}

async function startInteractionCapture(
  page: Page,
  now: () => Date,
): Promise<{
  readonly errors: () => readonly RecordedError[];
  readonly submissions: () => readonly UserSubmission[];
}> {
  const errors: RecordedError[] = [];
  const submissions: UserSubmission[] = [];

  await page.exposeFunction(SUBMISSION_BINDING, (value: unknown) => {
    if (!isUserSubmission(value)) {
      errors.push({
        timestamp: now().toISOString(),
        message: "Ignored an invalid browser submission event",
        source: "browser",
      });
      return;
    }
    const previous = submissions.at(-1);
    const isDuplicate =
      previous?.text === value.text &&
      Math.abs(Date.parse(previous.timestamp) - Date.parse(value.timestamp)) < 1_000;
    if (!isDuplicate) submissions.push(value);
  });

  await page.addInitScript(() => {
    function notify(text: string): void {
      const normalized = text.trim();
      if (normalized.length === 0) return;
      const callback: unknown = Reflect.get(
        globalThis,
        "__askMaerskResearchRecordSubmission",
      );
      if (typeof callback === "function") {
        callback({ text: normalized, timestamp: new Date().toISOString() });
      }
    }

    function readFormText(form: HTMLFormElement): string | undefined {
      const candidates = Array.from(form.elements).filter(
        (element): element is HTMLInputElement | HTMLTextAreaElement =>
          element instanceof HTMLTextAreaElement ||
          (element instanceof HTMLInputElement &&
            (element.type === "text" || element.type === "search")),
      );
      return candidates.findLast((element) => element.value.trim().length > 0)?.value;
    }

    globalThis.addEventListener(
      "submit",
      (event) => {
        if (event.target instanceof HTMLFormElement) {
          const text = readFormText(event.target);
          if (typeof text === "string") notify(text);
        }
      },
      true,
    );
    globalThis.addEventListener(
      "keydown",
      (event) => {
        if (
          event instanceof KeyboardEvent &&
          event.key === "Enter" &&
          !event.shiftKey &&
          (event.target instanceof HTMLInputElement ||
            event.target instanceof HTMLTextAreaElement)
        ) {
          notify(event.target.value);
        }
      },
      true,
    );
  });

  return { errors: () => errors, submissions: () => submissions };
}

function startNetworkCapture(
  context: BrowserContext,
  now: () => Date,
  eventSourceObservations: () => readonly EventSourceObservation[],
): {
  readonly finish: () => Promise<NetworkCaptureResult>;
} {
  const drafts: NetworkDraft[] = [];
  const errors: RecordedError[] = [];
  const requestDrafts = new WeakMap<Request, NetworkDraft>();
  const requestSettlements = new WeakMap<Request, () => void>();
  const responseSettlements: Promise<void>[] = [];
  let requestSequence = 0;

  context.on("request", (request) => {
    if (!isInterestingRequest(request)) return;
    requestSequence += 1;
    const parsedBody = parseBody(request.postData(), request.headers()["content-type"]);
    if (!parsedBody.ok) {
      errors.push({
        timestamp: now().toISOString(),
        message: parsedBody.error,
        source: "request",
      });
    }
    const draft: NetworkDraft = {
      id: `request-${requestSequence}`,
      timestamp: now().toISOString(),
      method: request.method(),
      url: request.url(),
      resourceType: request.resourceType(),
      requestHeaders: request.headers(),
      ...(typeof parsedBody.value === "undefined" ? {} : { requestBody: parsedBody.value }),
      ...(request.resourceType() === "eventsource" ? { frames: [] } : {}),
      settled: false,
      startedAtMs: now().getTime(),
    };
    const settlement = Promise.withResolvers<void>();
    responseSettlements.push(settlement.promise);
    requestSettlements.set(request, settlement.resolve);
    requestDrafts.set(request, draft);
    drafts.push(draft);
  });

  context.on("response", (response) => {
    const draft = requestDrafts.get(response.request());
    if (typeof draft === "undefined") return;
    const settle = requestSettlements.get(response.request());

    void readResponse(response, draft.resourceType, draft.startedAtMs, now)
      .then((captured) => {
        Object.assign(draft, captured.evidence);
        if (typeof captured.error !== "undefined") errors.push(captured.error);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        draft.failure = message;
        errors.push({ timestamp: now().toISOString(), message, source: "request" });
      })
      .finally(() => {
        draft.settled = true;
        settle?.();
      });
  });

  context.on("requestfailed", (request) => {
    const draft = requestDrafts.get(request);
    if (typeof draft === "undefined") return;
    const failure = request.failure()?.errorText ?? "Request failed";
    Object.assign(draft, {
      durationMs: Math.max(0, now().getTime() - draft.startedAtMs),
      failure,
    });
    draft.settled = true;
    requestSettlements.get(request)?.();
    errors.push({
      timestamp: now().toISOString(),
      message: `${failure}: ${request.method()} ${request.url()}`,
      source: "request",
    });
  });

  const observeWebSockets = (page: Page): void => {
    page.on("websocket", (webSocket) => {
      if (isKnownTelemetryUrl(webSocket.url())) return;
      requestSequence += 1;
      const draft: NetworkDraft = {
        id: `request-${requestSequence}`,
        timestamp: now().toISOString(),
        method: "GET",
        url: webSocket.url(),
        resourceType: "websocket",
        frames: [],
        settled: true,
        startedAtMs: now().getTime(),
      };
      drafts.push(draft);
      captureWebSocket(webSocket, draft, errors, now);
    });
  };
  observeContextPages(context, observeWebSockets);

  return {
    async finish() {
      await waitForSettlements(responseSettlements, 500);
      correlateEventSourceObservations(drafts, eventSourceObservations());
      const finishedAtMs = now().getTime();
      for (const draft of drafts) {
        if (!draft.settled && typeof draft.failure === "undefined") {
          draft.failure = "Response was still pending when recording completed";
          errors.push({
            timestamp: now().toISOString(),
            message: `${draft.failure}: ${draft.method} ${draft.url}`,
            source: "request",
          });
        }
        if (draft.resourceType === "eventsource") {
          draft.durationMs = Math.max(0, finishedAtMs - draft.startedAtMs);
        } else {
          draft.durationMs ??= Math.max(0, finishedAtMs - draft.startedAtMs);
        }
      }
      return { errors, network: drafts.map(toNetworkEvidence) };
    },
  };
}

function correlateEventSourceObservations(
  drafts: readonly NetworkDraft[],
  observations: readonly EventSourceObservation[],
): void {
  const availableDrafts = Map.groupBy(
    drafts.filter(({ resourceType }) => resourceType === "eventsource"),
    ({ url }) => url,
  );
  const activeDrafts = new Map<string, NetworkDraft>();

  for (const observation of observations) {
    const observationKey = `${observation.connectionId}:${observation.generation}`;
    if (observation.kind === "open") {
      const draft = availableDrafts.get(observation.url)?.shift();
      if (typeof draft !== "undefined") activeDrafts.set(observationKey, draft);
      continue;
    }
    activeDrafts.get(observationKey)?.frames?.push({
      direction: "received",
      eventName: observation.eventName,
      timestamp: observation.timestamp,
      payload: observation.data,
      payloadEncoding: "utf8",
    });
  }
}

async function waitForSettlements(
  settlements: readonly Promise<void>[],
  timeoutMs: number,
): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.all(settlements),
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    if (typeof timeout !== "undefined") clearTimeout(timeout);
  }
}

async function startEventSourceCapture(
  context: BrowserContext,
  now: () => Date,
): Promise<() => readonly EventSourceObservation[]> {
  const observations: EventSourceObservation[] = [];
  await context.exposeFunction(EVENT_SOURCE_BINDING, (value: unknown) => {
    if (!isEventSourceObservation(value)) return;
    observations.push({ ...value, timestamp: now().toISOString() });
  });
  await context.addInitScript(() => {
    const NativeEventSource = globalThis.EventSource;
    if (typeof NativeEventSource !== "function") return;
    class RecordedEventSource extends NativeEventSource {
      constructor(url: string | URL, eventSourceInitDict?: EventSourceInit) {
        super(url, eventSourceInitDict);
        const connectionId = crypto.randomUUID();
        let generation = 0;
        const notify = (kind: "message" | "open", data: string, eventName: string): void => {
          const callback: unknown = Reflect.get(
            globalThis,
            "__askMaerskResearchRecordEventSourceMessage",
          );
          if (typeof callback === "function") {
            callback({
              connectionId,
              data,
              eventName,
              generation,
              kind,
              timestamp: new Date().toISOString(),
              url: this.url,
            });
          }
        };
        super.addEventListener("open", () => {
          generation += 1;
          notify("open", "", "open");
        });
        super.addEventListener("message", (event) => {
          if (event instanceof MessageEvent) notify("message", String(event.data), "message");
        });
        const nativeAddEventListener = this.addEventListener.bind(this);
        const nativeRemoveEventListener = this.removeEventListener.bind(this);
        const listenerWrappers = new WeakMap<
          EventListenerOrEventListenerObject,
          Map<string, EventListener>
        >();
        Reflect.set(
          this,
          "addEventListener",
          (
            type: string,
            listener: EventListenerOrEventListenerObject | null,
            options?: boolean | AddEventListenerOptions,
          ): void => {
            if (listener === null) return;
            if (type === "open" || type === "message" || type === "error") {
              nativeAddEventListener(type, listener, options);
              return;
            }
            const wrapped: EventListener = (event) => {
              if (event instanceof MessageEvent) {
                notify("message", String(event.data), type);
              }
              if (typeof listener === "function") listener.call(this, event);
              else listener.handleEvent(event);
            };
            const wrappers = listenerWrappers.get(listener) ?? new Map<string, EventListener>();
            wrappers.set(type, wrapped);
            listenerWrappers.set(listener, wrappers);
            nativeAddEventListener(type, wrapped, options);
          },
        );
        Reflect.set(
          this,
          "removeEventListener",
          (
            type: string,
            listener: EventListenerOrEventListenerObject | null,
            options?: boolean | EventListenerOptions,
          ): void => {
            if (listener === null) return;
            const wrapped = listenerWrappers.get(listener)?.get(type);
            nativeRemoveEventListener(type, wrapped ?? listener, options);
          },
        );
      }
    }
    Reflect.set(globalThis, "EventSource", RecordedEventSource);
  });
  return () => observations;
}

function isEventSourceObservation(value: unknown): value is EventSourceObservation {
  return (
    typeof value === "object" &&
    value !== null &&
    "connectionId" in value &&
    typeof value.connectionId === "string" &&
    "data" in value &&
    typeof value.data === "string" &&
    "eventName" in value &&
    typeof value.eventName === "string" &&
    "generation" in value &&
    typeof value.generation === "number" &&
    "kind" in value &&
    (value.kind === "open" || value.kind === "message") &&
    "url" in value &&
    typeof value.url === "string" &&
    "timestamp" in value &&
    typeof value.timestamp === "string"
  );
}

function captureWebSocket(
  webSocket: PlaywrightWebSocket,
  draft: NetworkDraft,
  errors: RecordedError[],
  now: () => Date,
): void {
  webSocket.on("framesent", ({ payload }) => {
    draft.status ??= 101;
    draft.frames?.push(toNetworkFrame("sent", payload, now()));
  });
  webSocket.on("framereceived", ({ payload }) => {
    draft.status ??= 101;
    draft.frames?.push(toNetworkFrame("received", payload, now()));
  });
  webSocket.on("socketerror", (message) => {
    draft.failure = message;
    errors.push({ timestamp: now().toISOString(), message, source: "request" });
  });
  webSocket.on("close", () => {
    draft.durationMs = Math.max(0, now().getTime() - draft.startedAtMs);
  });
}

function toNetworkFrame(
  direction: NetworkFrameEvidence["direction"],
  payload: string | Buffer,
  timestamp: Date,
): NetworkFrameEvidence {
  return typeof payload === "string"
    ? { direction, timestamp: timestamp.toISOString(), payload, payloadEncoding: "utf8" }
    : {
        direction,
        timestamp: timestamp.toISOString(),
        payload: payload.toString("base64"),
        payloadEncoding: "base64",
      };
}

function isInterestingRequest(request: Request): boolean {
  if (isKnownTelemetryUrl(request.url())) return false;
  return (
    FUNCTIONAL_RESOURCE_TYPES.has(request.resourceType()) ||
    request.method() === "POST" ||
    URL.parse(request.url())?.pathname.toLowerCase().includes("graphql") === true
  );
}

function isKnownTelemetryUrl(value: string): boolean {
  const url = URL.parse(value);
  if (url === null) return false;
  const hostname = url.hostname.toLowerCase();
  return (
    TELEMETRY_DOMAINS.some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
    ) ||
    TELEMETRY_PATH.test(url.pathname)
  );
}

async function readResponse(
  response: Response,
  resourceType: string,
  startedAtMs: number,
  now: () => Date,
): Promise<{
  readonly error?: RecordedError;
  readonly evidence: Readonly<Partial<NetworkEvidence>>;
}> {
  const headers = await response.allHeaders();
  const parsedBody =
    resourceType === "eventsource"
      ? ({ ok: true, value: undefined } as const)
      : parseBody((await response.body()).toString("utf8"), headers["content-type"]);
  const status = response.status();
  const parseError = parsedBody.ok
    ? undefined
    : { timestamp: now().toISOString(), message: parsedBody.error, source: "request" as const };
  const httpError =
    status < 400
      ? undefined
      : {
          timestamp: now().toISOString(),
          message: `HTTP ${status} ${response.request().method()} ${response.url()}`,
          source: "request" as const,
        };

  const evidence = {
    status,
    responseHeaders: headers,
    ...(typeof parsedBody.value === "undefined" ? {} : { responseBody: parsedBody.value }),
    durationMs: Math.max(0, now().getTime() - startedAtMs),
  };
  const error = parseError ?? httpError;
  return typeof error === "undefined" ? { evidence } : { error, evidence };
}

function parseBody(body: string | null, contentType: string | undefined): BodyParseResult {
  if (body === null) return { ok: true, value: undefined };
  if (contentType?.includes("json") !== true) return { ok: true, value: body };

  try {
    return { ok: true, value: JSON.parse(body) as unknown };
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    return { error: `Could not parse JSON network body: ${detail}`, ok: false, value: body };
  }
}

function toNetworkEvidence(draft: NetworkDraft): NetworkEvidence {
  return {
    id: draft.id,
    timestamp: draft.timestamp,
    method: draft.method,
    url: draft.url,
    resourceType: draft.resourceType,
    ...(typeof draft.requestHeaders === "undefined"
      ? {}
      : { requestHeaders: draft.requestHeaders }),
    ...(typeof draft.requestBody === "undefined" ? {} : { requestBody: draft.requestBody }),
    ...(typeof draft.status === "undefined" ? {} : { status: draft.status }),
    ...(typeof draft.responseHeaders === "undefined"
      ? {}
      : { responseHeaders: draft.responseHeaders }),
    ...(typeof draft.responseBody === "undefined"
      ? {}
      : { responseBody: draft.responseBody }),
    ...(typeof draft.durationMs === "undefined" ? {} : { durationMs: draft.durationMs }),
    ...(typeof draft.failure === "undefined" ? {} : { failure: draft.failure }),
    ...(typeof draft.frames === "undefined" ? {} : { frames: draft.frames }),
  };
}

function validateExpectedMessages(
  expected: readonly string[],
  submissions: readonly UserSubmission[],
  now: Date,
): readonly RecordedError[] {
  const errors: RecordedError[] = [];
  for (const [turnIndex, message] of expected.entries()) {
    const observed = submissions[turnIndex]?.text;
    if (observed === message) continue;
    errors.push({
      timestamp: now.toISOString(),
      message:
        typeof observed === "undefined"
          ? `No browser submission was observed for turn ${turnIndex + 1}; expected “${message}”`
          : `Observed user submission for turn ${turnIndex + 1} did not match expected message “${message}”`,
      source: "browser",
    });
  }
  for (const [turnIndex] of submissions.slice(expected.length).entries()) {
    errors.push({
      timestamp: now.toISOString(),
      message: `Observed an unexpected user submission for turn ${expected.length + turnIndex + 1}`,
      source: "browser",
    });
  }
  return errors;
}

async function readAssistantText(page: Page, selector: string): Promise<string> {
  const selected = page.locator(selector).last();
  if ((await selected.count()) > 0) return (await readAssistantObservation(selected)).text;
  return (await page.locator("body").innerText()).trim();
}

async function readAssistantObservations(
  page: Page,
  selector: string,
): Promise<readonly AssistantObservation[]> {
  const assistants = page.locator(selector);
  const observations: AssistantObservation[] = [];
  for (let index = 0; index < (await assistants.count()); index += 1) {
    const assistant = assistants.nth(index);
    if (!(await assistant.isVisible())) continue;
    const observation = await readAssistantObservation(assistant);
    if (observation.text.length > 0) observations.push(observation);
  }
  if (observations.length > 0) return observations;
  const bodyText = (await page.locator("body").innerText()).trim();
  return bodyText.length === 0 ? [] : [{ text: bodyText, interfaceOffers: [] }];
}

async function readAssistantObservation(locator: Locator): Promise<AssistantObservation> {
  return locator.evaluate((element) => {
    const suggestedQuestionSelector =
      '[data-suggested-question], [data-testid*="suggest" i], [class*="suggested-question" i]';
    const offerSelector =
      'a, button, [role="button"], [data-suggested-question], [data-testid*="suggest" i], [class*="suggested-question" i]';
    const isSuggestedQuestion = (candidate: Element): boolean =>
      candidate.matches(suggestedQuestionSelector);
    const offers: Array<{
      href?: string;
      kind: "button" | "link" | "suggested-question";
      text: string;
    }> = [];
    const seen = new Set<string>();
    const nestedOffers = Array.from(element.querySelectorAll(offerSelector));
    const followingSiblingOffers = Array.from(
      element.parentElement?.querySelectorAll(suggestedQuestionSelector) ?? [],
    ).filter(
      (candidate) =>
        !element.contains(candidate) &&
        (element.compareDocumentPosition(candidate) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
    );
    for (const candidate of [...nestedOffers, ...followingSiblingOffers]) {
      const text = (candidate.textContent ?? "").trim();
      if (text.length === 0) continue;
      const kind = isSuggestedQuestion(candidate)
        ? "suggested-question"
        : candidate instanceof HTMLAnchorElement
          ? "link"
          : "button";
      const href = candidate instanceof HTMLAnchorElement ? candidate.href : undefined;
      const key = `${kind}\u0000${text}\u0000${href ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      offers.push({ kind, text, ...(typeof href === "undefined" ? {} : { href }) });
    }

    const textContainer = element.cloneNode(true);
    if (textContainer instanceof Element) {
      for (const offered of textContainer.querySelectorAll(offerSelector)) offered.remove();
    }
    const text = (textContainer.textContent ?? "").trim();
    return { interfaceOffers: offers, text };
  });
}

async function takeScreenshot(page: Page): Promise<Buffer> {
  return page.screenshot({ fullPage: false, type: "png" });
}

function isUserSubmission(value: unknown): value is UserSubmission {
  return (
    typeof value === "object" &&
    value !== null &&
    "text" in value &&
    typeof value.text === "string" &&
    "timestamp" in value &&
    typeof value.timestamp === "string" &&
    !Number.isNaN(Date.parse(value.timestamp))
  );
}
