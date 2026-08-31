import type { ResearchCase } from "../domain/research-case.ts";
import type { BrowserInteraction } from "../recording/record-research-session.ts";

export interface CaseInteractionOptions {
  readonly inputSelector?: string;
  readonly submitSelector?: string;
}

export function resolveCaseInteraction(
  case_: ResearchCase,
  options: CaseInteractionOptions,
): BrowserInteraction {
  if (case_.executionMode === "manual") return { mode: "manual" };
  return {
    mode: "automated",
    ...(typeof options.inputSelector === "undefined"
      ? {}
      : { inputSelector: options.inputSelector }),
    ...(typeof options.submitSelector === "undefined"
      ? {}
      : { submitSelector: options.submitSelector }),
  };
}
