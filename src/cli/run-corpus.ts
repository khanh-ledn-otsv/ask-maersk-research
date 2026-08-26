import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Analyzer } from "../analysis/analyze-evidence.ts";
import type { BrowserPreflight, BrowserPreflightResult } from "../browser/browser-preflight.ts";
import { loadApprovedTestData } from "../cases/load-approved-test-data.ts";
import { loadResearchCases } from "../cases/load-research-cases.ts";
import { prepareUnattendedCase } from "../cases/prepare-unattended-case.ts";
import { createPreflightFingerprint } from "../cases/preflight-fingerprint.ts";
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
  readonly browserPreflight?: BrowserPreflight;
  readonly createAnalyzer?: (apiKey: string) => Analyzer;
  readonly createCorpusRunId?: () => string;
  readonly createRunId: () => string;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly now: () => Date;
  readonly stdout: (message: string) => void;
  readonly waitForCompletion: () => Promise<void>;
}

interface CorpusOptionsBase {
  readonly allowAuthorizedData: boolean;
  readonly casesDirectory: string;
  readonly evidenceOutputRoot: string;
  readonly inputSelector?: string;
  readonly resumePath?: string;
  readonly selection: CorpusSelection;
  readonly submitSelector?: string;
  readonly summaryOutputRoot: string;
  readonly targetUrl: string;
  readonly testDataPath?: string;
}

interface CapturePreflight {
  readonly authenticated: boolean;
  readonly browserIssues: readonly string[];
  readonly testData: Readonly<Record<string, string>>;
}

type CorpusOptions = CorpusOptionsBase &
  (
    | { readonly mode: "capture-only" }
    | { readonly analysisPolicy: CorpusAnalysisPolicy; readonly mode: "analyzed" }
  );

type CorpusExecution =
  | {
      readonly mode: "capture-only";
      readonly executeCase: (case_: ResearchCase) => Promise<CorpusCaseExecution>;
    }
  | {
      readonly mode: "analyzed";
      readonly analysisPolicy: CorpusAnalysisPolicy;
      readonly executeCase: (case_: ResearchCase) => Promise<CorpusCaseExecution>;
    };

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
  try {
    const [cases, resumeFrom, testData] = await Promise.all([
      loadResearchCases(parsed.options.casesDirectory),
      typeof parsed.options.resumePath === "undefined"
        ? Promise.resolve(undefined)
        : readCorpusSummary(parsed.options.resumePath),
      loadApprovedTestData(parsed.options.testDataPath),
    ]);
    let receiptPreflight: BrowserPreflightResult | undefined;
    if (parsed.options.mode === "capture-only" && dependencies.environment.RESEARCH_HEADLESS === "true") {
      const receiptPath = dependencies.environment.RESEARCH_PREFLIGHT_RECEIPT ?? join(process.cwd(), ".research", "preflight.json");
      const fingerprint = createPreflightFingerprint({
        allowAuthorizedData: parsed.options.allowAuthorizedData,
        cases,
        ...(typeof parsed.options.inputSelector === "undefined" ? {} : { inputSelector: parsed.options.inputSelector }),
        selection: parsed.options.selection,
        ...(typeof parsed.options.submitSelector === "undefined" ? {} : { submitSelector: parsed.options.submitSelector }),
        targetUrl: parsed.options.targetUrl,
        testData,
      });
      receiptPreflight = await readMatchingPreflightReceipt(receiptPath, fingerprint);
      if (typeof receiptPreflight === "undefined") {
        stderr("Headless capture requires a matching successful preflight. Run: pnpm research preflight --all");
        return 1;
      }
    }
    const browserPreflight = receiptPreflight ?? (parsed.options.mode === "capture-only" && typeof dependencies.browserPreflight !== "undefined"
      ? await dependencies.browserPreflight.preflight({
          inputSelector: parsed.options.inputSelector ?? "",
          ...(typeof parsed.options.submitSelector === "undefined" ? {} : { submitSelector: parsed.options.submitSelector }),
          targetUrl: parsed.options.targetUrl,
        })
      : undefined);
    const execution = createCorpusExecution(parsed.options, dependencies, stderr, {
      authenticated: browserPreflight?.authenticated ?? true,
      browserIssues: browserPreflight?.issues ?? [],
      testData,
    });
    if (typeof execution === "undefined") return 1;
    const result = await runResearchCorpus(
      {
        cases,
        ...(execution.mode === "capture-only"
          ? { mode: "capture-only" as const }
          : { analysisPolicy: execution.analysisPolicy, mode: "analyzed" as const }),
        outputRoot: parsed.options.summaryOutputRoot,
        selection: parsed.options.selection,
        ...(typeof resumeFrom === "undefined" ? {} : { resumeFrom }),
        ...(typeof parsed.options.resumePath === "undefined"
          ? {}
          : { resumeFromPath: parsed.options.resumePath }),
      },
      {
        createCorpusRunId: dependencies.createCorpusRunId ?? dependencies.createRunId,
        executeCase: execution.executeCase,
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

function createCorpusExecution(
  options: CorpusOptions,
  dependencies: CorpusCliDependencies,
  stderr: (message: string) => void,
  preflight: CapturePreflight,
): CorpusExecution | undefined {
  if (options.mode === "capture-only") {
    return {
      mode: "capture-only",
      executeCase: (case_) => executeSelectedCaptureCase(case_, options, dependencies, preflight),
    };
  }
  const apiKey = dependencies.environment.OPEN_AI_API_KEY;
  if (typeof apiKey === "undefined" || apiKey.trim().length === 0) {
    stderr("OPEN_AI_API_KEY is required for corpus analysis.");
    return undefined;
  }
  if (typeof dependencies.createAnalyzer === "undefined") {
    stderr("Corpus analysis is not configured.");
    return undefined;
  }
  const analyzer = dependencies.createAnalyzer(apiKey);
  return {
    mode: "analyzed",
    analysisPolicy: options.analysisPolicy,
    executeCase: (case_) =>
      executeSelectedAnalyzedCase(case_, options, analyzer, dependencies),
  };
}

async function executeSelectedCaptureCase(
  case_: ResearchCase,
  options: Extract<CorpusOptions, { mode: "capture-only" }>,
  dependencies: CorpusCliDependencies,
  preflight: CapturePreflight,
): Promise<CorpusCaseExecution> {
  const prepared = prepareUnattendedCase(case_, {
    allowAuthorizedData: options.allowAuthorizedData,
    authenticated: preflight.authenticated,
    browserIssues: preflight.browserIssues,
    ...(typeof options.inputSelector === "undefined" ? {} : { inputSelector: options.inputSelector }),
    ...(typeof options.submitSelector === "undefined" ? {} : { submitSelector: options.submitSelector }),
    testData: preflight.testData,
  });
  if (!prepared.ok) {
    return {
      status: "preflight-required",
      reason: prepared.reason,
    };
  }
  dependencies.stdout(`Running ${case_.id}: ${case_.objective}`);
  return captureCorpusCase(
    prepared.case,
    executionOptions(prepared.interaction, options, dependencies),
    executionDependencies(dependencies),
  );
}

async function executeSelectedAnalyzedCase(
  case_: ResearchCase,
  options: Extract<CorpusOptions, { mode: "analyzed" }>,
  analyzer: Analyzer,
  dependencies: CorpusCliDependencies,
): Promise<CorpusCaseExecution> {
  if (case_.executionMode === "automated" && case_.dataPolicy === "authorized") {
    return {
      status: "skipped",
      reason: "Authorized-data automation must be captured first with --capture-only, --allow-authorized-data, and approved test data.",
    };
  }
  const interaction = resolveCaseInteraction(case_, options);
  if (typeof interaction === "undefined") {
    return {
      status: "skipped",
      reason: "Automated case skipped because ASK_MAERSK_INPUT_SELECTOR is not configured.",
    };
  }
  dependencies.stdout(`Running ${case_.id}: ${case_.objective}`);
  if (case_.executionMode === "manual") {
    dependencies.stdout(
      "Interact with Ask Maersk, then return here and press Enter to save evidence.",
    );
  }
  return executeCorpusCase(
    case_,
    options.analysisPolicy,
    executionOptions(interaction, options, dependencies),
    { ...executionDependencies(dependencies), analyzer },
  );
}

function executionOptions(
  interaction: NonNullable<ReturnType<typeof resolveCaseInteraction>>,
  options: CorpusOptionsBase,
  dependencies: CorpusCliDependencies,
) {
  return {
    interaction,
    outputRoot: options.evidenceOutputRoot,
    targetUrl: options.targetUrl,
    waitForCompletion: dependencies.waitForCompletion,
  };
}

function executionDependencies(dependencies: CorpusCliDependencies) {
  return {
    browser: dependencies.browser,
    createRunId: dependencies.createRunId,
    now: dependencies.now,
  };
}

function parseCorpusOptions(
  arguments_: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
): CorpusOptionsResult {
  const parsedFlags = parseFlags(arguments_, {
    "--all": "boolean",
    "--allow-authorized-data": "boolean",
    "--case": "value",
    "--cases": "value",
    "--capture-only": "boolean",
    "--category": "value",
    "--input-selector": "value",
    "--model": "value",
    "--output": "value",
    "--reasoning-effort": "value",
    "--resume": "value",
    "--submit-selector": "value",
    "--test-data": "value",
    "--summary-output": "value",
    "--url": "value",
  });
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
  let selection: CorpusSelection;
  if (all) selection = { all: true };
  else if (typeof caseId !== "undefined") selection = { caseId };
  else if (typeof category !== "undefined") selection = { category };
  else return { ok: false, message: "Corpus selection is required." };
  const inputSelector =
    parsedFlags.values.get("--input-selector") ?? environment.ASK_MAERSK_INPUT_SELECTOR;
  const submitSelector =
    parsedFlags.values.get("--submit-selector") ?? environment.ASK_MAERSK_SUBMIT_SELECTOR;
  const resumePath = parsedFlags.values.get("--resume");
  const testDataPath = parsedFlags.values.get("--test-data") ?? environment.RESEARCH_TEST_DATA_FILE;
  const commonOptions: CorpusOptionsBase = {
    allowAuthorizedData: parsedFlags.values.has("--allow-authorized-data"),
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
    ...(typeof testDataPath === "undefined" ? {} : { testDataPath }),
    ...(typeof inputSelector === "undefined" ? {} : { inputSelector }),
    ...(typeof submitSelector === "undefined" ? {} : { submitSelector }),
    ...(typeof resumePath === "undefined" ? {} : { resumePath }),
  };
  if (captureOnly) {
    return { ok: true, options: { ...commonOptions, mode: "capture-only" } };
  }
  const policy = resolveAnalysisPolicy(parsedFlags.values, environment);
  if (!policy.ok) return policy;
  return {
    ok: true,
    options: {
      ...commonOptions,
      analysisPolicy: policy.policy,
      mode: "analyzed",
    },
  };
}

async function readMatchingPreflightReceipt(
  path: string,
  fingerprint: string,
): Promise<BrowserPreflightResult | undefined> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as {
      browser?: BrowserPreflightResult;
      cases?: { status?: unknown }[];
      configurationFingerprint?: unknown;
    };
    const matches = value.configurationFingerprint === fingerprint &&
      Array.isArray(value.cases) &&
      value.cases.some(({ status }) => status === "preflight-ready");
    return matches && isBrowserPreflightResult(value.browser) ? value.browser : undefined;
  } catch {
    return undefined;
  }
}

function isBrowserPreflightResult(value: unknown): value is BrowserPreflightResult {
  return typeof value === "object" && value !== null &&
    "authenticated" in value && typeof value.authenticated === "boolean" &&
    "pageUrl" in value && typeof value.pageUrl === "string" &&
    "issues" in value && Array.isArray(value.issues) &&
    value.issues.every((issue) => typeof issue === "string");
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
