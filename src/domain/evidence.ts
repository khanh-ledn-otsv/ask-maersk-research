export interface ConversationTurn {
  readonly index: number;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly timestamp: string;
  readonly screenshot?: string;
  readonly interfaceOffers?: readonly InterfaceOfferEvidence[];
}

export interface InterfaceOfferEvidence {
  readonly kind: "button" | "link" | "suggested-question";
  readonly text: string;
  readonly href?: string;
}

export interface ScreenshotCapture {
  readonly filename: string;
  readonly kind: "start" | "result" | "error";
  readonly data: Buffer;
}

export interface ScreenshotEvidence {
  readonly path: string;
  readonly kind: "start" | "result" | "error";
}

export interface TraceCapture {
  readonly filename: string;
  readonly data: Buffer;
}

export interface TraceEvidence {
  readonly path: string;
}

export interface NetworkEvidence {
  readonly id: string;
  readonly timestamp: string;
  readonly method: string;
  readonly url: string;
  readonly resourceType: string;
  readonly status?: number;
  readonly requestHeaders?: Readonly<Record<string, string>>;
  readonly requestBody?: unknown;
  readonly responseHeaders?: Readonly<Record<string, string>>;
  readonly responseBody?: unknown;
  readonly durationMs?: number;
  readonly failure?: string;
  readonly frames?: readonly NetworkFrameEvidence[];
}

export interface NetworkFrameEvidence {
  readonly direction: "received" | "sent";
  readonly eventName?: string;
  readonly timestamp: string;
  readonly payload: string;
  readonly payloadEncoding: "base64" | "utf8";
}

export interface TimingEvidence {
  readonly turnIndex: number;
  readonly submittedAt: string;
  readonly firstLoadingIndicatorMs?: number;
  readonly firstVisibleResponseMs?: number;
  readonly completedResponseMs?: number;
}

export interface RecordedError {
  readonly timestamp: string;
  readonly message: string;
  readonly source: "browser" | "page" | "request";
}

export interface BrowserCapture {
  readonly page: {
    readonly url: string;
    readonly title: string;
  };
  readonly conversation: readonly ConversationTurn[];
  readonly screenshots: readonly ScreenshotCapture[];
  readonly network: readonly NetworkEvidence[];
  readonly timings: readonly TimingEvidence[];
  readonly errors: readonly RecordedError[];
  readonly trace?: TraceCapture;
}

export interface CaseEvidence {
  readonly caseId?: string;
  readonly runId: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly conversation: readonly ConversationTurn[];
  readonly screenshots: readonly ScreenshotEvidence[];
  readonly network: readonly NetworkEvidence[];
  readonly timings: readonly TimingEvidence[];
  readonly page: {
    readonly url: string;
    readonly title: string;
  };
  readonly errors: readonly RecordedError[];
  readonly trace?: TraceEvidence;
}
