import { join } from "node:path";
import type { Analyzer } from "../analysis/analyze-evidence.ts";
import { analyzeCapturedCorpus } from "../corpus/analyze-captured-corpus.ts";
import { formatAnalysisUsage, resolveAnalysisPolicy } from "./analysis-policy.ts";
import { parseFlags } from "./parse-flags.ts";

export interface AnalyzeCorpusCliDependencies {
  readonly createAnalyzer?: (apiKey: string) => Analyzer;
  readonly createCorpusRunId?: () => string;
  readonly createRunId: () => string;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly now: () => Date;
  readonly stdout: (message: string) => void;
}

export async function runCorpusAnalysis(
  arguments_: readonly string[],
  dependencies: AnalyzeCorpusCliDependencies,
  stderr: (message: string) => void,
): Promise<number> {
  const [captureSummaryPath, ...flags] = arguments_;
  if (typeof captureSummaryPath === "undefined" || captureSummaryPath.startsWith("--")) {
    stderr("Usage: pnpm research analyze-corpus <capture-summary> [options]");
    return 1;
  }
  const parsed = parseFlags(flags, {
    "--model": "value",
    "--reasoning-effort": "value",
    "--summary-output": "value",
  });
  if (!parsed.ok) {
    stderr(parsed.message);
    return 1;
  }
  const policy = resolveAnalysisPolicy(parsed.values, dependencies.environment);
  if (!policy.ok) {
    stderr(policy.message);
    return 1;
  }
  const apiKey = dependencies.environment.OPEN_AI_API_KEY;
  if (typeof apiKey === "undefined" || apiKey.trim().length === 0) {
    stderr("OPEN_AI_API_KEY is required for corpus analysis.");
    return 1;
  }
  if (typeof dependencies.createAnalyzer === "undefined") {
    stderr("Corpus analysis is not configured.");
    return 1;
  }
  try {
    const result = await analyzeCapturedCorpus(
      {
        analysisPolicy: policy.policy,
        captureSummaryPath,
        outputRoot: parsed.values.get("--summary-output") ??
          dependencies.environment.RESEARCH_CORPUS_OUTPUT_DIR ??
          join(process.cwd(), "data", "corpus-runs"),
      },
      {
        analyzer: dependencies.createAnalyzer(apiKey),
        createCorpusRunId: dependencies.createCorpusRunId ?? dependencies.createRunId,
        now: dependencies.now,
        onCaseStart: (caseId, evidencePath) =>
          dependencies.stdout(`Analyzing ${caseId}: ${evidencePath}`),
      },
    );
    dependencies.stdout(`Analyzed corpus summary saved: ${result.summaryPath}`);
    dependencies.stdout(formatAnalysisUsage(policy.policy, result.summary.aggregateUsage));
    return result.summary.cases.some(({ status }) => status === "failed") ? 1 : 0;
  } catch (error: unknown) {
    stderr(`Corpus analysis failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
