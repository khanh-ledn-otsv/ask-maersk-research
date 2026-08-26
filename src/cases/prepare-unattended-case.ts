import type { ResearchCase } from "../domain/research-case.ts";
import type { BrowserInteraction } from "../recording/record-research-session.ts";

export interface UnattendedCasePolicy {
  readonly allowAuthorizedData: boolean;
  readonly authenticated: boolean;
  readonly browserIssues: readonly string[];
  readonly inputSelector?: string;
  readonly submitSelector?: string;
  readonly testData: Readonly<Record<string, string>>;
}

export type PreparedUnattendedCase =
  | { readonly ok: true; readonly case: ResearchCase; readonly interaction: BrowserInteraction }
  | { readonly ok: false; readonly reason: string };

export function prepareUnattendedCase(
  case_: ResearchCase,
  policy: UnattendedCasePolicy,
): PreparedUnattendedCase {
  const reasons = [...policy.browserIssues];
  if (case_.executionMode !== "automated") reasons.push("Case declares manual setup and cannot run unattended.");
  if (typeof policy.inputSelector === "undefined" || policy.inputSelector.trim().length === 0) {
    reasons.push("ASK_MAERSK_INPUT_SELECTOR is required.");
  }
  if (case_.authenticated && !policy.authenticated) reasons.push("Case requires an authenticated browser session.");

  const placeholders = case_.testDataPlaceholders ?? [];
  if (case_.dataPolicy === "authorized") {
    if (!policy.allowAuthorizedData) reasons.push("Authorized-data automation requires --allow-authorized-data.");
    if (placeholders.length === 0) reasons.push("Authorized-data case declares no approved test-data placeholders.");
    for (const placeholder of placeholders) {
      const value = policy.testData[placeholder];
      if (typeof value === "undefined" || value.trim().length === 0) {
        reasons.push(`Approved test value ${placeholder} is missing.`);
      }
    }
  } else if (placeholders.length > 0) {
    reasons.push("Public and fake-data cases may not consume configured identifier values.");
  }

  if (reasons.length > 0) return { ok: false, reason: reasons.join(" ") };
  const messages = case_.messages.map(({ text }) => ({
    text: placeholders.reduce(
      (message, placeholder) => message.replaceAll(`{{${placeholder}}}`, policy.testData[placeholder] ?? ""),
      text,
    ),
  }));
  const unresolved = messages.flatMap(({ text }) => text.match(/\{\{[A-Z0-9_]+\}\}/gu) ?? []);
  if (unresolved.length > 0) {
    return { ok: false, reason: `Unresolved test-data placeholders: ${[...new Set(unresolved)].join(", ")}.` };
  }
  return {
    ok: true,
    case: { ...case_, messages },
    interaction: {
      inputSelector: policy.inputSelector as string,
      mode: "automated",
      ...(typeof policy.submitSelector === "undefined" ? {} : { submitSelector: policy.submitSelector }),
    },
  };
}
