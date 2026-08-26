import {
  chromium,
  type Locator,
  type Page,
  type Request,
  type Response,
} from "playwright";
import type {
  BrowserCapture,
  ConversationTurn,
  NetworkEvidence,
  RecordedError,
} from "../domain/evidence.ts";
import type {
  BrowserRecorder,
  BrowserRecordingInput,
} from "../recording/record-research-session.ts";

const INTERESTING_RESOURCE_TYPES = new Set(["fetch", "xhr"]);
const SUBMISSION_BINDING = "__askMaerskResearchRecordSubmission";

export interface PlaywrightBrowserRecorderOptions {
  readonly assistantSelector?: string;
  readonly headless?: boolean;
  readonly now?: () => Date;
  readonly sensitiveSelector?: string;
  readonly userDataDirectory: string;
}

interface NetworkDraft {
  id: string;
  timestamp: string;
  method: string;
  url: string;
  resourceType: string;
  requestHeaders: Readonly<Record<string, string>>;
  requestBody?: unknown;
  responseHeaders?: Readonly<Record<string, string>>;
  responseBody?: unknown;
  status?: number;
  durationMs?: number;
  failure?: string;
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

type BodyParseResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly error: string; readonly ok: false; readonly value: string };

export function createPlaywrightBrowserRecorder(
  options: PlaywrightBrowserRecorderOptions,
): BrowserRecorder {
  const now = options.now ?? (() => new Date());
  const assistantSelector =
    options.assistantSelector ??
    '[data-message-author-role="assistant"], [data-role="assistant"], [data-testid*="assistant"], main';
  const sensitiveSelector =
    options.sensitiveSelector ?? 'input, textarea, [data-sensitive="true"]';

  return {
    async capture(input) {
      return captureWithPlaywright(input, {
        assistantSelector,
        headless: options.headless ?? false,
        now,
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
  const pageErrors = startPageErrorCapture(page, options.now);
  const networkCapture = startNetworkCapture(page, options.now);
  const interaction = await startInteractionCapture(page, options.now);

  try {
    await page.goto(input.targetUrl, { waitUntil: "domcontentloaded" });
    const recordingStartedAt = options.now();
    const startScreenshot = await takeMaskedScreenshot(
      page,
      options.sensitiveSelector,
      interaction.submissions(),
    );

    await input.waitForCompletion();

    const completedAt = options.now();
    const assistantText = await readAssistantText(page, options.assistantSelector);
    const resultScreenshot = await takeMaskedScreenshot(
      page,
      options.sensitiveSelector,
      interaction.submissions(),
    );
    const network = await networkCapture.finish();
    const conversation = buildConversation(
      interaction.submissions(),
      assistantText,
      completedAt.toISOString(),
    );
    const submittedAt = conversation.find((turn) => turn.role === "user")?.timestamp;
    const errors = [
      ...pageErrors(),
      ...network.errors,
      ...interaction.errors(),
      ...validateExpectedMessage(input.expectedUserMessage, conversation, completedAt),
    ].toSorted((left, right) => left.timestamp.localeCompare(right.timestamp));

    return {
      page: { url: page.url(), title: await page.title() },
      conversation,
      screenshots: [
        { filename: "01-start.png", kind: "start", data: startScreenshot },
        { filename: "02-result.png", kind: "result", data: resultScreenshot },
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

function startPageErrorCapture(
  page: Page,
  now: () => Date,
): () => readonly RecordedError[] {
  const errors: RecordedError[] = [];
  page.on("pageerror", (error) => {
    errors.push({ timestamp: now().toISOString(), message: error.message, source: "page" });
  });
  page.on("crash", () => {
    errors.push({ timestamp: now().toISOString(), message: "Page crashed", source: "browser" });
  });
  return () => errors;
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

function startNetworkCapture(page: Page, now: () => Date): {
  readonly finish: () => Promise<NetworkCaptureResult>;
} {
  const drafts: NetworkDraft[] = [];
  const errors: RecordedError[] = [];
  const requestDrafts = new WeakMap<Request, NetworkDraft>();
  const responseReads: Promise<void>[] = [];
  let requestSequence = 0;

  page.on("request", (request) => {
    if (!INTERESTING_RESOURCE_TYPES.has(request.resourceType())) return;
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
      startedAtMs: now().getTime(),
    };
    requestDrafts.set(request, draft);
    drafts.push(draft);
  });

  page.on("response", (response) => {
    const draft = requestDrafts.get(response.request());
    if (typeof draft === "undefined") return;

    const read = readResponse(response, draft.startedAtMs, now)
      .then((captured) => {
        Object.assign(draft, captured.evidence);
        if (typeof captured.error !== "undefined") errors.push(captured.error);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        draft.failure = message;
        errors.push({ timestamp: now().toISOString(), message, source: "request" });
      });
    responseReads.push(read);
  });

  page.on("requestfailed", (request) => {
    const draft = requestDrafts.get(request);
    if (typeof draft === "undefined") return;
    const failure = request.failure()?.errorText ?? "Request failed";
    Object.assign(draft, {
      durationMs: Math.max(0, now().getTime() - draft.startedAtMs),
      failure,
    });
    errors.push({
      timestamp: now().toISOString(),
      message: `${failure}: ${request.method()} ${request.url()}`,
      source: "request",
    });
  });

  return {
    async finish() {
      await Promise.all(responseReads);
      return { errors, network: drafts.map(toNetworkEvidence) };
    },
  };
}

async function readResponse(
  response: Response,
  startedAtMs: number,
  now: () => Date,
): Promise<{
  readonly error?: RecordedError;
  readonly evidence: Readonly<Partial<NetworkEvidence>>;
}> {
  const headers = await response.allHeaders();
  const parsedBody = parseBody((await response.body()).toString("utf8"), headers["content-type"]);
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
    responseBody: parsedBody.value,
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
    requestHeaders: draft.requestHeaders,
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
  submissions: readonly UserSubmission[],
): Promise<Buffer> {
  const masks: Locator[] = [
    page.locator(sensitiveSelector),
    ...submissions.map((submission) => page.getByText(submission.text, { exact: true })),
  ];
  return page.screenshot({ fullPage: true, mask: masks, maskColor: "#000000", type: "png" });
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
