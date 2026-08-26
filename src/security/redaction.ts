import type {
  ConversationTurn,
  NetworkEvidence,
  RecordedError,
} from "../domain/evidence.ts";

const REDACTED = "[REDACTED]";
export const SENSITIVE_TEXT_PATTERN_SOURCES: readonly string[] = [
  String.raw`\bBearer\s+[A-Za-z0-9._~+/=-]+`,
  String.raw`\b(?:authorization|cookies?|set[-_ ]?cookie|api[-_ ]?key|csrf(?:[-_ ]?token)?|access[-_ ]?token|refresh[-_ ]?token|id[-_ ]?token|auth[-_ ]?token|token|jwt|sessions?|session[-_ ]?id|password|passwd|secrets?)\s*[:=]\s*[^\s&;,]+`,
  String.raw`\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b`,
];
const SENSITIVE_KEY_PARTS = new Set([
  "authorization",
  "cookie",
  "csrf",
  "jwt",
  "password",
  "passwd",
  "secret",
  "session",
  "token",
]);

export function redactConversationTurn(
  turn: ConversationTurn,
  sensitiveValues: readonly string[] = [],
): ConversationTurn {
  return { ...turn, text: redactText(turn.text, sensitiveValues) };
}

export function redactNetworkEvidence(
  evidence: NetworkEvidence,
  sensitiveValues: readonly string[] = [],
): NetworkEvidence {
  return {
    ...evidence,
    url: redactUrl(evidence.url, sensitiveValues),
    ...(typeof evidence.requestHeaders === "undefined"
      ? {}
      : { requestHeaders: redactHeaders(evidence.requestHeaders, sensitiveValues) }),
    ...(typeof evidence.requestBody === "undefined"
      ? {}
      : { requestBody: redactUnknown(evidence.requestBody, sensitiveValues) }),
    ...(typeof evidence.responseHeaders === "undefined"
      ? {}
      : { responseHeaders: redactHeaders(evidence.responseHeaders, sensitiveValues) }),
    ...(typeof evidence.responseBody === "undefined"
      ? {}
      : { responseBody: redactUnknown(evidence.responseBody, sensitiveValues) }),
    ...(typeof evidence.failure === "undefined"
      ? {}
      : { failure: redactText(evidence.failure, sensitiveValues) }),
    ...(typeof evidence.frames === "undefined"
      ? {}
      : {
          frames: evidence.frames.map((frame) => ({
            ...frame,
            payload:
              frame.payloadEncoding === "utf8"
                ? redactText(frame.payload, sensitiveValues)
                : REDACTED,
          })),
        }),
  };
}

export function redactRecordedError(
  error: RecordedError,
  sensitiveValues: readonly string[] = [],
): RecordedError {
  return { ...error, message: redactText(error.message, sensitiveValues) };
}

export function redactUrl(value: string, sensitiveValues: readonly string[] = []): string {
  const url = URL.parse(value);
  if (url === null) return redactText(value, sensitiveValues);

  for (const key of url.searchParams.keys()) {
    if (isSensitiveKey(key)) url.searchParams.set(key, REDACTED);
  }
  if (url.username.length > 0) url.username = REDACTED;
  if (url.password.length > 0) url.password = REDACTED;
  url.hash = redactText(url.hash, sensitiveValues);
  return redactConfiguredValues(url.toString(), sensitiveValues);
}

export function redactText(value: string, sensitiveValues: readonly string[] = []): string {
  return SENSITIVE_TEXT_PATTERN_SOURCES.reduce(
    (redacted, pattern) => redacted.replace(new RegExp(pattern, "giu"), REDACTED),
    redactConfiguredValues(value, sensitiveValues),
  );
}

function redactConfiguredValues(value: string, sensitiveValues: readonly string[]): string {
  const configuredValues = sensitiveValues
    .filter((sensitiveValue) => sensitiveValue.length > 0)
    .flatMap((sensitiveValue) => [sensitiveValue, encodeURIComponent(sensitiveValue)])
    .toSorted((left, right) => right.length - left.length);
  return configuredValues.reduce(
    (text, sensitiveValue) => text.replaceAll(sensitiveValue, REDACTED),
    value,
  );
}

function redactHeaders(
  headers: Readonly<Record<string, string>>,
  sensitiveValues: readonly string[],
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      isSensitiveKey(key) ? REDACTED : redactText(value, sensitiveValues),
    ]),
  );
}

function redactUnknown(
  value: unknown,
  sensitiveValues: readonly string[],
  key?: string,
): unknown {
  if (typeof key === "string" && isSensitiveKey(key)) return REDACTED;
  if (Array.isArray(value)) return value.map((entry) => redactUnknown(entry, sensitiveValues));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redactUnknown(entryValue, sensitiveValues, entryKey),
      ]),
    );
  }
  if (typeof value === "string") return redactText(value, sensitiveValues);
  return value;
}

function isSensitiveKey(key: string): boolean {
  const normalized = key
    .replace(/([a-z\d])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z\d]+/g, "_");
  const parts = normalized.split("_");
  return (
    parts.some((part) => SENSITIVE_KEY_PARTS.has(part)) ||
    normalized.replaceAll("_", "").includes("apikey")
  );
}
