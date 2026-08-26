import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Analyzer } from "../analysis/analyze-evidence.ts";
import { loadResearchCases } from "../cases/load-research-cases.ts";
import { resolveCaseInteraction } from "../cases/resolve-case-interaction.ts";
import { captureCorpusCase, executeCorpusCase } from "../corpus/execute-corpus-case.ts";
import {
  runResearchCorpus,
  type CorpusAnalysisPolicy,
  type CorpusCaseExecution,
  type CorpusSelection,
  type CorpusSummary,
} from "../corpus/run-research-corpus.ts";
import {
  RESEARCH_CATEGORIES,
  type ResearchCase,
  type ResearchCategory,
} from "../domain/research-case.ts";
import type { BrowserRecorder } from "../recording/record-research-session.ts";
import { formatAnalysisUsage, resolveAnalysisPolicy } from "./analysis-policy.ts";
import { parseFlags } from "./parse-flags.ts";

export interface CorpusCliDependencies {
  readonly browser: BrowserRecorder;
  readonly createAnalyzer?: (apiKey: string) => Analyzer;
  readonly createCorpusRunId?: () => string;
  readonly createRunId: () => string;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly now: () => Date;
  readonly stdout: (message: string) => void;
  readonly waitForCompletion: () => Promise<void>;
}

interface CorpusOptions {
  readonly analysisPolicy?: CorpusAnalysisPolicy;
  readonly captureOnly: boolean;
  readonly casesDirectory: string;
  readonly evidenceOutputRoot: string;
  readonly inputSelector?: string;
  readonly resumePath?: string;
  readonly selection: CorpusSelection;
  readonly submitSelector?: string;
  readonly summaryOutputRoot: string;
  readonly targetUrl: string;
}

type CorpusOptionsResult =
  | { readonly ok: true; readonly options: CorpusOptions }
  | { readonly message: string; readonly ok: false };

export async function runCorpus(
  arguments_: readonly string[],
  dependencies: CorpusCliDependencies,
  stderr: (message: string) => void,
): Promise<number> {
  const parsed = parseCorpusOptions(arguments_, dependencies.environment);
  if (!parsed.ok) {
    stderr(parsed.message);
    return 1;
  }
  let analyzer: Analyzer | undefined;
  if (!parsed.options.captureOnly) {
    const apiKey = dependencies.environment.OPEN_AI_API_KEY;
    if (typeof apiKey === "undefined" || apiKey.trim().length === 0) {
      stderr("OPEN_AI_API_KEY is required for corpus analysis.");
      return 1;
    }
    if (typeof dependencies.createAnalyzer === "undefined") {
      stderr("Corpus analysis is not configured.");
      return 1;
    }
    analyzer = dependencies.createAnalyzer(apiKey);
  }

  try {
    const [cases, resumeFrom] = await Promise.all([
      loadResearchCases(parsed.options.casesDirectory),
      typeof parsed.options.resumePath === "undefined"
        ? Promise.resolve(undefined)
        : readCorpusSummary(parsed.options.resumePath),
    ]);
    const result = await runResearchCorpus(
      {
        cases,
        ...(parsed.options.captureOnly
          ? { mode: "capture-only" as const }
          : { analysisPolicy: parsed.options.analysisPolicy!, mode: "analyzed" as const }),
        outputRoot: parsed.options.summaryOutputRoot,
        selection: parsed.options.selection,
        ...(typeof resumeFrom === "undefined" ? {} : { resumeFrom }),
        ...(typeof parsed.options.resumePath === "undefined"
          ? {}
          : { resumeFromPath: parsed.options.resumePath }),
      },
      {
        createCorpusRunId: dependencies.createCorpusRunId ?? dependencies.createRunId,
        executeCase: (case_, policy) =>
          executeSelectedCase(case_, policy, parsed.options, analyzer, dependencies),
        now: dependencies.now,
      },
    );
    dependencies.stdout(`Corpus summary saved: ${result.summaryPath}`);
    if (result.summary.schemaVersion === 2) {
      for (const case_ of result.summary.cases) {
        if (case_.status === "captured") {
          dependencies.stdout(
            `Next paid step (${case_.caseId}): pnpm research analyze ${dirname(case_.evidencePath)}`,
          );
        }
      }
    } else {
      dependencies.stdout(formatCorpusUsage(result.summary));
    }
    return result.summary.cases.some(({ status }) =>
      status === "failed" || status === "capture-failed"
    ) ? 1 : 0;
  } catch (error: unknown) {
    stderr(`Corpus run failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

async function executeSelectedCase(
  case_: ResearchCase,
  policy: CorpusAnalysisPolicy | undefined,
  options: CorpusOptions,
  analyzer: Analyzer | undefined,
  dependencies: CorpusCliDependencies,
): Promise<CorpusCaseExecution> {
  if (options.captureOnly && case_.executionMode === "manual") {
    if (case_.dataPolicy === "authorized") {
      return {
        status: "skipped",
        reason: "Authorized-data case safely skipped until approved test data is configured.",
      };
    }
    return {
      status: "preflight-required",
      reason: "Manual case requires fake test data and researcher setup before capture.",
    };
  }
  const interaction = resolveCaseInteraction(case_, options);
  if (typeof interaction === "undefined") {
    return {
      status: options.captureOnly ? "preflight-required" : "skipped",
      reason: options.captureOnly
        ? "Automated case requires ASK_MAERSK_INPUT_SELECTOR before capture."
        : "Automated case skipped because ASK_MAERSK_INPUT_SELECTOR is not configured.",
    };
  }
  dependencies.stdout(`Running ${case_.id}: ${case_.objective}`);
  if (case_.executionMode === "manual") {
    dependencies.stdout(
      "Interact with Ask Maersk, then return here and press Enter to save evidence.",
    );
  }
  const executionOptions = {
    interaction,
    outputRoot: options.evidenceOutputRoot,
    targetUrl: options.targetUrl,
    waitForCompletion: dependencies.waitForCompletion,
  };
  const executionDependencies = {
    browser: dependencies.browser,
    createRunId: dependencies.createRunId,
    now: dependencies.now,
  };
  if (options.captureOnly) {
    return captureCorpusCase(case_, executionOptions, executionDependencies);
  }
  return executeCorpusCase(case_, policy!, executionOptions, {
    ...executionDependencies,
    analyzer: analyzer!,
  });
}

function parseCorpusOptions(
  arguments_: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
): CorpusOptionsResult {
  const parsedFlags = parseFlags(arguments_, [
    "--all",
    "--case",
    "--cases",
    "--capture-only",
    "--category",
    "--input-selector",
    "--model",
    "--output",
    "--reasoning-effort",
    "--resume",
    "--submit-selector",
    "--summary-output",
    "--url",
  ], ["--all", "--capture-only"]);
  if (!parsedFlags.ok) return parsedFlags;
  const caseId = parsedFlags.values.get("--case");
  const category = parsedFlags.values.get("--category");
  const all = parsedFlags.values.has("--all");
  const captureOnly = parsedFlags.values.has("--capture-only");
  const selectionCount = Number(typeof caseId !== "undefined") +
    Number(typeof category !== "undefined") + Number(all);
  if (selectionCount !== 1) {
    return {
      ok: false,
      message: "Corpus selection requires exactly one of --all, --case <id>, or --category <category>.",
    };
  }
  if (all && !captureOnly) {
    return {
      ok: false,
      message: "--all requires --capture-only to prevent unapproved analysis cost.",
    };
  }
  if (typeof category !== "undefined" && !isResearchCategory(category)) {
    return {
      ok: false,
      message: `Research category must be one of: ${RESEARCH_CATEGORIES.join(", ")}.`,
    };
  }
  const targetUrl = parsedFlags.values.get("--url") ?? environment.ASK_MAERSK_URL;
  if (typeof targetUrl === "undefined" || targetUrl.trim().length === 0) {
    return {
      ok: false,
      message: "ASK_MAERSK_URL is required. Set it in .env or pass --url <url>.",
    };
  }
  const parsedUrl = URL.parse(targetUrl);
  if (parsedUrl === null || (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:")) {
    return { ok: false, message: "Ask Maersk URL must be an http:// or https:// URL." };
  }
  const policy = captureOnly ? undefined : resolveAnalysisPolicy(parsedFlags.values, environment);
  if (typeof policy !== "undefined" && !policy.ok) return policy;
  const selection: CorpusSelection =
    all ? { all: true } : typeof caseId === "undefined" ? { category: category! } : { caseId };
  const inputSelector =
    parsedFlags.values.get("--input-selector") ?? environment.ASK_MAERSK_INPUT_SELECTOR;
  const submitSelector =
    parsedFlags.values.get("--submit-selector") ?? environment.ASK_MAERSK_SUBMIT_SELECTOR;
  const resumePath = parsedFlags.values.get("--resume");
  return {
    ok: true,
    options: {
      captureOnly,
      casesDirectory:
        parsedFlags.values.get("--cases") ??
        environment.RESEARCH_CASES_DIR ??
        join(process.cwd(), "cases"),
      evidenceOutputRoot:
        parsedFlags.values.get("--output") ??
        environment.RESEARCH_OUTPUT_DIR ??
        join(process.cwd(), "data", "runs"),
      selection,
      summaryOutputRoot:
        parsedFlags.values.get("--summary-output") ??
        environment.RESEARCH_CORPUS_OUTPUT_DIR ??
        join(process.cwd(), "data", "corpus-runs"),
      targetUrl: parsedUrl.toString(),
      ...(typeof policy === "undefined" ? {} : { analysisPolicy: policy.policy }),
      ...(typeof inputSelector === "undefined" ? {} : { inputSelector }),
      ...(typeof submitSelector === "undefined" ? {} : { submitSelector }),
      ...(typeof resumePath === "undefined" ? {} : { resumePath }),
    },
  };
}

function isResearchCategory(value: string): value is ResearchCategory {
  return RESEARCH_CATEGORIES.some((category) => category === value);
}

async function readCorpusSummary(path: string): Promise<CorpusSummary> {
  const value = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (
    typeof value !== "object" ||
    value === null ||
    !("schemaVersion" in value) ||
    (value.schemaVersion !== 1 && value.schemaVersion !== 2) ||
    !("cases" in value) ||
    !Array.isArray(value.cases)
  ) {
    throw new Error(`Invalid corpus summary: ${path}.`);
  }
  if (value.schemaVersion === 2 && (!("mode" in value) || value.mode !== "capture-only")) {
    throw new Error(`Invalid capture-only corpus summary: ${path}.`);
  }
  return value as CorpusSummary;
}

function formatCorpusUsage(summary: CorpusSummary): string {
  if (summary.schemaVersion !== 1) return "Capture-only corpus: no analysis usage.";
  return formatAnalysisUsage(
    summary.analysisPolicy,
    summary.aggregateUsage,
    "Corpus analysis",
  );
}
