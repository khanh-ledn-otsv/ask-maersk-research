import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  analyzeEvidence,
  type Analyzer,
  type Finding,
  type ReasoningEffort,
} from "../analysis/analyze-evidence.ts";
import type { CaseEvidence } from "../domain/evidence.ts";
import { formatAnalysisUsage, resolveAnalysisPolicy } from "./analysis-policy.ts";
import { parseFlags } from "./parse-flags.ts";

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
    dependencies.stdout(formatFindingUsage(completedFinding));
    return 0;
  } catch (error: unknown) {
    if (typeof completedFinding !== "undefined") {
      dependencies.stdout(formatFindingUsage(completedFinding));
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
  const parsedFlags = parseFlags(flags, ["--model", "--reasoning-effort"]);
  if (!parsedFlags.ok) return parsedFlags;
  const policy = resolveAnalysisPolicy(parsedFlags.values, environment);
  return policy.ok
    ? { ok: true, options: { ...policy.policy, runDirectory } }
    : policy;
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

function formatFindingUsage(finding: Finding): string {
  return formatAnalysisUsage(
    {
      model: finding.analysis.model,
      reasoningEffort: finding.analysis.reasoningEffort,
    },
    finding.analysis.usage,
  );
}
