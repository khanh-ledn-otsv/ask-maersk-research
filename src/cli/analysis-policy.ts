import {
  DEFAULT_ANALYSIS_MODEL,
  DEFAULT_REASONING_EFFORT,
  type AnalysisUsage,
  type ReasoningEffort,
} from "../analysis/analyze-evidence.ts";

export interface AnalysisPolicy {
  readonly model: string;
  readonly reasoningEffort: ReasoningEffort;
}

export type AnalysisPolicyResult =
  | { readonly ok: true; readonly policy: AnalysisPolicy }
  | { readonly message: string; readonly ok: false };

export function resolveAnalysisPolicy(
  values: ReadonlyMap<string, string>,
  environment: Readonly<Record<string, string | undefined>>,
): AnalysisPolicyResult {
  const model =
    values.get("--model") ?? environment.RESEARCH_ANALYSIS_MODEL ?? DEFAULT_ANALYSIS_MODEL;
  if (model.trim().length === 0) {
    return { ok: false, message: "Analysis model must not be empty." };
  }
  const reasoningEffort =
    values.get("--reasoning-effort") ??
    environment.RESEARCH_ANALYSIS_REASONING_EFFORT ??
    DEFAULT_REASONING_EFFORT;
  if (!isReasoningEffort(reasoningEffort)) {
    return {
      ok: false,
      message: "Reasoning effort must be one of: none, low, medium, high, xhigh.",
    };
  }
  return { ok: true, policy: { model, reasoningEffort } };
}

export function formatAnalysisUsage(
  policy: AnalysisPolicy,
  usage: AnalysisUsage | undefined,
  prefix = "Analysis",
): string {
  return [
    `${prefix}: model=${policy.model}`,
    `reasoning=${policy.reasoningEffort}`,
    `input=${formatTokenCount(usage?.inputTokens)}`,
    `cached-input=${formatTokenCount(usage?.cachedInputTokens)}`,
    `output=${formatTokenCount(usage?.outputTokens)}`,
    `reasoning-tokens=${formatTokenCount(usage?.reasoningTokens)}`,
  ].join(" ");
}

function isReasoningEffort(value: string): value is ReasoningEffort {
  return ["none", "low", "medium", "high", "xhigh"].includes(value);
}

function formatTokenCount(value: number | undefined): string {
  return typeof value === "undefined" ? "not-returned" : String(value);
}
