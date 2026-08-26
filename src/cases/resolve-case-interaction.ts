import type { ResearchCase } from "../domain/research-case.ts";
import type { BrowserInteraction } from "../recording/record-research-session.ts";

export interface CaseInteractionOptions {
  readonly inputSelector?: string;
  readonly submitSelector?: string;
}

export function resolveCaseInteraction(
  case_: ResearchCase,
  options: CaseInteractionOptions,
): BrowserInteraction | undefined {
  if (case_.executionMode === "manual") return { mode: "manual" };
  if (typeof options.inputSelector === "undefined" || options.inputSelector.length === 0) {
    return undefined;
  }
  return {
    inputSelector: options.inputSelector,
    mode: "automated",
    ...(typeof options.submitSelector === "undefined"
      ? {}
      : { submitSelector: options.submitSelector }),
  };
}
