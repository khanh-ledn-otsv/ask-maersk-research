import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  analyzeEvidence,
  DEFAULT_ANALYSIS_MODEL,
  DEFAULT_REASONING_EFFORT,
  type Analyzer,
  type Finding,
  type ReasoningEffort,
} from "../analysis/analyze-evidence.ts";
import type { CaseEvidence } from "../domain/evidence.ts";

export interface AnalysisCliDependencies {
  readonly createAnalyzer?: (apiKey: string) => Analyzer;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly stdout: (message: string) => void;
}

interface AnalysisOptions {
  readonly model: string;
  readonly reasoningEffort: ReasoningEffort;
  readonly runDirectory: string;
}

type AnalysisOptionsResult =
  | { readonly ok: true; readonly options: AnalysisOptions }
  | { readonly message: string; readonly ok: false };

export async function runAnalysis(
  arguments_: readonly string[],
  dependencies: AnalysisCliDependencies,
  stderr: (message: string) => void,
): Promise<number> {
  const parsed = parseAnalysisOptions(arguments_, dependencies.environment);
  if (!parsed.ok) {
    stderr(parsed.message);
    return 1;
  }
  const apiKey = dependencies.environment.OPEN_AI_API_KEY;
  if (typeof apiKey === "undefined" || apiKey.trim().length === 0) {
    stderr("OPEN_AI_API_KEY is required for analysis. Recording remains available without it.");
    return 1;
  }
  if (typeof dependencies.createAnalyzer === "undefined") {
    stderr("Analysis is not configured.");
    return 1;
  }

  const findingPath = join(parsed.options.runDirectory, "finding.json");
  let completedFinding: Finding | undefined;
  try {
    await assertFindingDoesNotExist(findingPath);
    const evidence = JSON.parse(
      await readFile(join(parsed.options.runDirectory, "evidence.json"), "utf8"),
    ) as CaseEvidence;
    completedFinding = await analyzeEvidence(evidence, {
      analyzer: dependencies.createAnalyzer(apiKey),
      model: parsed.options.model,
      reasoningEffort: parsed.options.reasoningEffort,
    });
    await writeFile(findingPath, `${JSON.stringify(completedFinding, null, 2)}\n`, { flag: "wx" });
    dependencies.stdout(`Finding saved: ${findingPath}`);
    dependencies.stdout(formatAnalysisUsage(completedFinding));
    return 0;
  } catch (error: unknown) {
    if (typeof completedFinding !== "undefined") {
      dependencies.stdout(formatAnalysisUsage(completedFinding));
    }
    stderr(`Analysis failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

function parseAnalysisOptions(
  arguments_: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
): AnalysisOptionsResult {
  const [runDirectory, ...flags] = arguments_;
  if (typeof runDirectory === "undefined" || runDirectory.startsWith("--")) {
    return { ok: false, message: "Usage: pnpm research analyze <run-directory> [options]" };
  }
  const parsedFlags = parseAnalysisFlags(flags);
  if (!parsedFlags.ok) return parsedFlags;
  const model =
    parsedFlags.values.get("--model") ??
    environment.RESEARCH_ANALYSIS_MODEL ??
    DEFAULT_ANALYSIS_MODEL;
  if (model.trim().length === 0) {
    return { ok: false, message: "Analysis model must not be empty." };
  }
  const reasoningEffort =
    parsedFlags.values.get("--reasoning-effort") ??
    environment.RESEARCH_ANALYSIS_REASONING_EFFORT ??
    DEFAULT_REASONING_EFFORT;
  if (!isReasoningEffort(reasoningEffort)) {
    return {
      ok: false,
      message: "Reasoning effort must be one of: none, low, medium, high, xhigh.",
    };
  }
  return { ok: true, options: { model, reasoningEffort, runDirectory } };
}

type AnalysisFlagsResult =
  | { readonly ok: true; readonly values: ReadonlyMap<string, string> }
  | { readonly message: string; readonly ok: false };

function parseAnalysisFlags(arguments_: readonly string[]): AnalysisFlagsResult {
  const values = new Map<string, string>();
  const allowed = ["--model", "--reasoning-effort"];
  for (let index = 0; index < arguments_.length; index += 2) {
    const flag = arguments_[index];
    const value = arguments_[index + 1];
    if (typeof flag === "undefined" || typeof value === "undefined") {
      return { ok: false, message: `Missing value for ${flag ?? "option"}.` };
    }
    if (!allowed.includes(flag)) return { ok: false, message: `Unknown option: ${flag}` };
    values.set(flag, value);
  }
  return { ok: true, values };
}

function isReasoningEffort(value: string): value is ReasoningEffort {
  return ["none", "low", "medium", "high", "xhigh"].includes(value);
}

async function assertFindingDoesNotExist(findingPath: string): Promise<void> {
  try {
    await access(findingPath);
  } catch (error: unknown) {
    if (isFileSystemError(error, "ENOENT")) return;
    throw error;
  }
  throw new Error(`Finding already exists: ${findingPath}.`);
}

function isFileSystemError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

function formatAnalysisUsage(finding: Finding): string {
  const usage = finding.analysis.usage;
  return [
    `Analysis: model=${finding.analysis.model}`,
    `reasoning=${finding.analysis.reasoningEffort}`,
    `input=${formatTokenCount(usage?.inputTokens)}`,
    `cached-input=${formatTokenCount(usage?.cachedInputTokens)}`,
    `output=${formatTokenCount(usage?.outputTokens)}`,
    `reasoning-tokens=${formatTokenCount(usage?.reasoningTokens)}`,
  ].join(" ");
}

function formatTokenCount(value: number | undefined): string {
  return typeof value === "undefined" ? "not-returned" : String(value);
}
