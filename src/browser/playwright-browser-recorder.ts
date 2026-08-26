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
  NetworkEvidence,
  NetworkFrameEvidence,
  RecordedError,
} from "../domain/evidence.ts";
import type {
  BrowserRecorder,
  BrowserRecordingInput,
} from "../recording/record-research-session.ts";
import { SENSITIVE_TEXT_PATTERN_SOURCES } from "../security/redaction.ts";

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

export interface PlaywrightBrowserRecorderOptions {
  readonly assistantSelector?: string;
  readonly headless?: boolean;
  readonly now?: () => Date;
  readonly resultSelector?: string;
  readonly sensitiveSelector?: string;
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
): BrowserRecorder {
  const now = options.now ?? (() => new Date());
  const assistantSelector =
    options.assistantSelector ??
    '.mc-c-ask-maersk, [data-message-author-role="assistant"], [data-role="assistant"], [data-testid*="assistant"], main';
  const resultSelector = options.resultSelector ?? ".mc-c-ask-maersk";
  const sensitiveSelector =
    options.sensitiveSelector ?? 'input, textarea, [data-sensitive="true"]';

  return {
    async capture(input) {
      return captureWithPlaywright(input, {
        assistantSelector,
        headless: options.headless ?? false,
        now,
        resultSelector,
        sensitiveSelector,
        userDataDirectory: options.userDataDirectory,
      });
    },
  };
}

interface ResolvedOptions {
  readonly assistantSelector: string;
  readonly headless: boolean;
  readonly now: () => Date;
  readonly resultSelector: string;
  readonly sensitiveSelector: string;
  readonly userDataDirectory: string;
}

async function captureWithPlaywright(
  input: BrowserRecordingInput,
  options: ResolvedOptions,
): Promise<BrowserCapture> {
  const context = await chromium.launchPersistentContext(options.userDataDirectory, {
    headless: options.headless,
    viewport: { width: 1_440, height: 1_000 },
  });
  const page = context.pages()[0] ?? (await context.newPage());
  const interaction = await startInteractionCapture(page, options.now);
  const sensitiveTexts = (): readonly string[] =>
    buildSensitiveTexts(interaction.submissions(), input.sensitiveValues);
  const pageErrors = startBrowserErrorCapture(context, options.now, (errorPage) =>
    takeMaskedScreenshot(errorPage, options.sensitiveSelector, sensitiveTexts()),
  );
  const eventSourceObservations = await startEventSourceCapture(context, options.now);
  const networkCapture = startNetworkCapture(context, options.now, eventSourceObservations);

  try {
    await page.goto(input.targetUrl, { waitUntil: "domcontentloaded" });
    const recordingStartedAt = options.now();
    const startScreenshot = await takeMaskedScreenshot(
      page,
      options.sensitiveSelector,
      sensitiveTexts(),
    );

    await input.waitForCompletion();

    const completedAt = options.now();
    const resultPage = await findResultPage(context.pages(), page, options.resultSelector);
    await resultPage.bringToFront();
    const exceptionalStates = await inspectExceptionalStates(
      resultPage,
      options.assistantSelector,
      completedAt,
    );
    const assistantText = await readAssistantText(resultPage, options.assistantSelector);
    const resultScreenshot = await takeMaskedScreenshot(
      resultPage,
      options.sensitiveSelector,
      sensitiveTexts(),
    );
    const network = await networkCapture.finish();
    const conversation = buildConversation(
      interaction.submissions(),
      assistantText,
      completedAt.toISOString(),
    );
    const submittedAt = conversation.find((turn) => turn.role === "user")?.timestamp;
    const lateErrors = [
      ...network.errors,
      ...interaction.errors(),
      ...exceptionalStates,
      ...validateExpectedMessage(input.expectedUserMessage, conversation, completedAt),
    ];
    const errors = [
      ...pageErrors.errors(),
      ...lateErrors,
    ].toSorted((left, right) => left.timestamp.localeCompare(right.timestamp));
    const eventScreenshots = await pageErrors.screenshots();
    const lateScreenshots = await captureRepeatedScreenshots(
      resultPage,
      lateErrors.length,
      options.sensitiveSelector,
      sensitiveTexts(),
    );
    const diagnosticScreenshots = [...eventScreenshots, ...lateScreenshots].map(
      (data, index) => ({
        filename: `${String(index + 3).padStart(2, "0")}-error.png`,
        kind: "error" as const,
        data,
      }),
    );

    return {
      page: { url: resultPage.url(), title: await resultPage.title() },
      conversation,
      screenshots: [
        { filename: "01-start.png", kind: "start", data: startScreenshot },
        { filename: "02-result.png", kind: "result", data: resultScreenshot },
        ...diagnosticScreenshots,
      ],
      network: network.network,
      timings: {
        submittedAt: submittedAt ?? recordingStartedAt.toISOString(),
        completedResponseMs: Math.max(
          0,
          completedAt.getTime() - Date.parse(submittedAt ?? recordingStartedAt.toISOString()),
        ),
      },
      errors,
    };
  } finally {
    await context.close();
  }
}

function buildSensitiveTexts(
  submissions: readonly UserSubmission[],
  configuredValues: readonly string[] = [],
): readonly string[] {
  return [...submissions.map(({ text }) => text), ...configuredValues];
}

async function captureRepeatedScreenshots(
  page: Page,
  count: number,
  sensitiveSelector: string,
  sensitiveTexts: readonly string[],
): Promise<readonly Buffer[]> {
  const screenshots: Buffer[] = [];
  for (let index = 0; index < count; index += 1) {
    screenshots.push(await takeMaskedScreenshot(page, sensitiveSelector, sensitiveTexts));
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

function buildConversation(
  submissions: readonly UserSubmission[],
  assistantText: string,
  assistantTimestamp: string,
): readonly ConversationTurn[] {
  const latestSubmission = submissions.at(-1);
  const userTurns: readonly ConversationTurn[] =
    typeof latestSubmission === "undefined"
      ? []
      : [
          {
            index: 0,
            role: "user",
            text: latestSubmission.text,
            timestamp: latestSubmission.timestamp,
          },
        ];
  return [
    ...userTurns,
    {
      index: userTurns.length,
      role: "assistant",
      text: assistantText,
      timestamp: assistantTimestamp,
      screenshot: "screenshots/02-result.png",
    },
  ];
}

function validateExpectedMessage(
  expected: string,
  conversation: readonly ConversationTurn[],
  now: Date,
): readonly RecordedError[] {
  const observed = conversation.find((turn) => turn.role === "user")?.text;
  if (observed === expected) return [];
  return [
    {
      timestamp: now.toISOString(),
      message:
        typeof observed === "undefined"
          ? `No browser submission was observed; expected “${expected}”`
          : `Observed user submission did not match expected message “${expected}”`,
      source: "browser",
    },
  ];
}

async function readAssistantText(page: Page, selector: string): Promise<string> {
  const selected = page.locator(selector).last();
  if ((await selected.count()) > 0) return (await selected.innerText()).trim();
  return (await page.locator("body").innerText()).trim();
}

async function takeMaskedScreenshot(
  page: Page,
  sensitiveSelector: string,
  sensitiveTexts: readonly string[],
): Promise<Buffer> {
  const credentialMask = await markCredentialText(page);
  const masks: Locator[] = [
    page.locator(sensitiveSelector),
    credentialMask.locator,
    ...sensitiveTexts
      .filter((text) => text.length > 0)
      .map((text) => page.getByText(text, { exact: false })),
  ];
  try {
    return await page.screenshot({
      fullPage: false,
      mask: masks,
      maskColor: "#000000",
      type: "png",
    });
  } finally {
    await credentialMask.cleanup();
  }
}

async function markCredentialText(page: Page): Promise<{
  readonly cleanup: () => Promise<void>;
  readonly locator: Locator;
}> {
  const attribute = "data-ask-maersk-sensitive-text";
  const marker = `${Date.now()}-${Math.random()}`;
  await page.locator("body").evaluate(
    (body, { attribute, marker, patternSources }) => {
      const findMatches = (text: string): readonly string[] =>
        patternSources.flatMap((source) =>
          Array.from(text.matchAll(new RegExp(source, "giu")), ([match]) => match.toLowerCase()),
        );
      const matchCounts = (matches: readonly string[]): ReadonlyMap<string, number> => {
        const counts = new Map<string, number>();
        for (const match of matches) counts.set(match, (counts.get(match) ?? 0) + 1);
        return counts;
      };
      const covers = (available: readonly string[], required: readonly string[]): boolean => {
        const availableCounts = matchCounts(available);
        return [...matchCounts(required)].every(
          ([match, count]) => (availableCounts.get(match) ?? 0) >= count,
        );
      };
      const depth = (element: Element): number => {
        let value = 0;
        for (let parent = element.parentElement; parent !== null; parent = parent.parentElement) {
          value += 1;
        }
        return value;
      };
      const matches = new Map<HTMLElement, readonly string[]>();
      const candidates = [body, ...body.querySelectorAll("*")]
        .filter(
          (element): element is HTMLElement =>
            element instanceof HTMLElement && element.getClientRects().length > 0,
        )
        .filter((element) => {
          const found = findMatches(element.innerText);
          if (found.length === 0) return false;
          matches.set(element, found);
          return true;
        })
        .toSorted((left, right) => depth(right) - depth(left));
      const selected: HTMLElement[] = [];
      for (const candidate of candidates) {
        const selectedDescendants = selected.filter((element) => candidate.contains(element));
        const coveredMatches = selectedDescendants.flatMap((element) => matches.get(element) ?? []);
        if (covers(coveredMatches, matches.get(candidate) ?? [])) continue;
        for (const descendant of selectedDescendants) {
          selected.splice(selected.indexOf(descendant), 1);
        }
        selected.push(candidate);
      }
      for (const element of selected) element.setAttribute(attribute, marker);
    },
    { attribute, marker, patternSources: SENSITIVE_TEXT_PATTERN_SOURCES },
  );
  const locator = page.locator(`[${attribute}="${marker}"]`);
  return {
    locator,
    async cleanup() {
      await locator
        .evaluateAll((elements, attribute) => {
          for (const element of elements) element.removeAttribute(attribute);
        }, attribute)
        .catch(() => undefined);
    },
  };
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
