import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  AnalysisUsage,
} from "../analysis/analyze-evidence.ts";
import type { AnalysisPolicy } from "../cli/analysis-policy.ts";
import type {
  ResearchCase,
  ResearchCategory,
  ResearchDataPolicy,
  ResearchExecutionMode,
} from "../domain/research-case.ts";

export type CorpusSelection =
  | { readonly caseId: string }
  | { readonly category: ResearchCategory };

export type CorpusAnalysisPolicy = AnalysisPolicy;

export type CorpusCaseExecution =
  | {
      readonly status: "completed";
      readonly evidencePath: string;
      readonly findingPath: string;
      readonly usage?: AnalysisUsage;
    }
  | {
      readonly status: "failed";
      readonly error: string;
      readonly evidencePath?: string;
    }
  | { readonly status: "skipped"; readonly reason: string };

export interface CorpusCaseDescriptor {
  readonly caseId: string;
  readonly category: ResearchCategory;
  readonly objective: string;
  readonly authenticated: boolean;
  readonly dataPolicy: ResearchDataPolicy;
  readonly executionMode: ResearchExecutionMode;
  readonly notes?: string;
}

export type CorpusCaseResult = CorpusCaseDescriptor &
  ({
      readonly status: "completed";
      readonly evidencePath: string;
      readonly findingPath: string;
      readonly usage?: AnalysisUsage;
      readonly resumed?: true;
    }
  | {
      readonly status: "failed";
      readonly error: string;
      readonly evidencePath?: string;
    }
  | {
      readonly status: "skipped";
      readonly reason: string;
    });

export interface CorpusSummary {
  readonly schemaVersion: 1;
  readonly corpusRunId: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly selection: CorpusSelection;
  readonly analysisPolicy: CorpusAnalysisPolicy;
  readonly aggregateUsage: AnalysisUsage;
  readonly cases: readonly CorpusCaseResult[];
  readonly resumedFrom?: string;
}

export interface RunResearchCorpusInput {
  readonly analysisPolicy: CorpusAnalysisPolicy;
  readonly cases: readonly ResearchCase[];
  readonly outputRoot: string;
  readonly resumeFrom?: CorpusSummary;
  readonly resumeFromPath?: string;
  readonly selection: CorpusSelection;
}

export interface RunResearchCorpusDependencies {
  readonly createCorpusRunId: () => string;
  readonly executeCase: (
    case_: ResearchCase,
    analysisPolicy: CorpusAnalysisPolicy,
  ) => Promise<CorpusCaseExecution>;
  readonly now: () => Date;
}

export interface ResearchCorpusRun {
  readonly runDirectory: string;
  readonly summary: CorpusSummary;
  readonly summaryPath: string;
}

export async function runResearchCorpus(
  input: RunResearchCorpusInput,
  dependencies: RunResearchCorpusDependencies,
): Promise<ResearchCorpusRun> {
  const selectedCases = selectCases(input.cases, input.selection);
  assertCompatibleResume(input);
  const startedAt = dependencies.now().toISOString();
  const corpusRunId = `${formatRunTimestamp(startedAt)}_${dependencies.createCorpusRunId()}`;
  const runDirectory = join(input.outputRoot, corpusRunId);
  const priorCompleted = new Map(
    (input.resumeFrom?.cases ?? [])
      .filter((result): result is Extract<CorpusCaseResult, { status: "completed" }> =>
        result.status === "completed"
      )
      .map((result) => [result.caseId, result]),
  );
  const results: CorpusCaseResult[] = [];

  for (const case_ of selectedCases) {
    const prior = priorCompleted.get(case_.id);
    if (typeof prior !== "undefined") {
      results.push({ ...prior, resumed: true });
      continue;
    }
    results.push(await executeCase(case_, input.analysisPolicy, dependencies));
  }

  const summary: CorpusSummary = {
    schemaVersion: 1,
    corpusRunId,
    startedAt,
    completedAt: dependencies.now().toISOString(),
    selection: input.selection,
    analysisPolicy: input.analysisPolicy,
    aggregateUsage: aggregateUsage(results),
    cases: results,
    ...(typeof input.resumeFromPath === "undefined"
      ? {}
      : { resumedFrom: input.resumeFromPath }),
  };
  const summaryPath = join(runDirectory, "summary.json");
  await mkdir(input.outputRoot, { recursive: true });
  await mkdir(runDirectory);
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, { flag: "wx" });
  return { runDirectory, summary, summaryPath };
}

function selectCases(
  cases: readonly ResearchCase[],
  selection: CorpusSelection,
): readonly ResearchCase[] {
  if ("caseId" in selection) {
    const selected = cases.find(({ id }) => id === selection.caseId);
    if (typeof selected === "undefined") {
      throw new Error(`Research case "${selection.caseId}" was not found.`);
    }
    return [selected];
  }
  const selected = cases.filter(({ category }) => category === selection.category);
  if (selected.length === 0) {
    throw new Error(`Research category "${selection.category}" has no cases.`);
  }
  return selected;
}

function assertCompatibleResume(input: RunResearchCorpusInput): void {
  if (typeof input.resumeFrom === "undefined") return;
  if (JSON.stringify(input.resumeFrom.selection) !== JSON.stringify(input.selection)) {
    throw new Error("The resumed summary selection does not match the requested selection.");
  }
  if (
    input.resumeFrom.analysisPolicy.model !== input.analysisPolicy.model ||
    input.resumeFrom.analysisPolicy.reasoningEffort !== input.analysisPolicy.reasoningEffort
  ) {
    throw new Error("The resumed summary analysis policy does not match the requested policy.");
  }
}

async function executeCase(
  case_: ResearchCase,
  analysisPolicy: CorpusAnalysisPolicy,
  dependencies: RunResearchCorpusDependencies,
): Promise<CorpusCaseResult> {
  const caseDescriptor = {
    caseId: case_.id,
    category: case_.category,
    objective: case_.objective,
    authenticated: case_.authenticated,
    dataPolicy: case_.dataPolicy,
    executionMode: case_.executionMode,
    ...(typeof case_.notes === "undefined" ? {} : { notes: case_.notes }),
  };
  try {
    const execution = await dependencies.executeCase(case_, analysisPolicy);
    return { ...caseDescriptor, ...execution };
  } catch (error: unknown) {
    return {
      ...caseDescriptor,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function aggregateUsage(results: readonly CorpusCaseResult[]): AnalysisUsage {
  const usage = results.flatMap((result) =>
    result.status === "completed" && typeof result.usage !== "undefined"
      ? [result.usage]
      : [],
  );
  return Object.fromEntries(
    (["inputTokens", "cachedInputTokens", "outputTokens", "reasoningTokens"] as const)
      .map((key) => {
        const values = usage.flatMap((entry) =>
          typeof entry[key] === "undefined" ? [] : [entry[key]],
        );
        return values.length === 0 ? undefined : [key, values.reduce((sum, value) => sum + value, 0)];
      })
      .filter((entry): entry is [keyof AnalysisUsage, number] => entry !== undefined),
  );
}

function formatRunTimestamp(isoTimestamp: string): string {
  return isoTimestamp.slice(0, 19).replace("T", "_").replaceAll(":", "");
}
