import type {
  ConversationTurn,
  NetworkEvidence,
  RecordedError,
} from "../domain/evidence.ts";

const REDACTED = "[REDACTED]";
const SENSITIVE_KEYS = new Set([
  "access_token",
  "authorization",
  "cookie",
  "csrf",
  "jwt",
  "password",
  "refresh_token",
  "secret",
  "session",
  "set_cookie",
  "x_api_key",
]);

export function redactConversationTurn(turn: ConversationTurn): ConversationTurn {
  return { ...turn, text: redactText(turn.text) };
}

export function redactNetworkEvidence(evidence: NetworkEvidence): NetworkEvidence {
  return {
    ...evidence,
    url: redactUrl(evidence.url),
    ...(typeof evidence.requestHeaders === "undefined"
      ? {}
      : { requestHeaders: redactHeaders(evidence.requestHeaders) }),
    ...(typeof evidence.requestBody === "undefined"
      ? {}
      : { requestBody: redactUnknown(evidence.requestBody) }),
    ...(typeof evidence.responseHeaders === "undefined"
      ? {}
      : { responseHeaders: redactHeaders(evidence.responseHeaders) }),
    ...(typeof evidence.responseBody === "undefined"
      ? {}
      : { responseBody: redactUnknown(evidence.responseBody) }),
    ...(typeof evidence.failure === "undefined"
      ? {}
      : { failure: redactText(evidence.failure) }),
  };
}

export function redactRecordedError(error: RecordedError): RecordedError {
  return { ...error, message: redactText(error.message) };
}

export function redactUrl(value: string): string {
  const url = URL.parse(value);
  if (url === null) return redactText(value);

  for (const key of url.searchParams.keys()) {
    if (isSensitiveKey(key)) url.searchParams.set(key, REDACTED);
  }
  return url.toString();
}

function redactHeaders(
  headers: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      isSensitiveKey(key) ? REDACTED : redactText(value),
    ]),
  );
}

function redactUnknown(value: unknown, key?: string): unknown {
  if (typeof key === "string" && isSensitiveKey(key)) return REDACTED;
  if (Array.isArray(value)) return value.map((entry) => redactUnknown(entry));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redactUnknown(entryValue, entryKey),
      ]),
    );
  }
  if (typeof value === "string") return redactText(value);
  return value;
}

function redactText(value: string): string {
  return value.replace(
    /\b(?:Bearer\s+)?(?:access_token|refresh_token|jwt|session|secret|password)=?[^\s&;,]*/giu,
    REDACTED,
  );
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase().replaceAll("-", "_"));
}
