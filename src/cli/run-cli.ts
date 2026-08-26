import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  analyzeEvidence,
  DEFAULT_ANALYSIS_MODEL,
  DEFAULT_REASONING_EFFORT,
  type Analyzer,
  type Finding,
  type ReasoningEffort,
} from "../analysis/analyze-evidence.ts";
import { loadResearchCases } from "../cases/load-research-cases.ts";
import type { CaseEvidence } from "../domain/evidence.ts";
import type { ResearchCase } from "../domain/research-case.ts";
import {
  recordResearchSession,
  type BrowserRecorder,
} from "../recording/record-research-session.ts";

export interface CliDependencies {
  readonly browser: BrowserRecorder;
  readonly createAnalyzer?: (apiKey: string) => Analyzer;
  readonly createRunId: () => string;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly now: () => Date;
  readonly stderr?: (message: string) => void;
  readonly stdout: (message: string) => void;
  readonly waitForCompletion: () => Promise<void>;
}

interface RecordOptions {
  readonly outputRoot: string;
  readonly targetUrl: string;
  readonly userMessage: string;
}

interface RunOptions extends RecordOptions {
  readonly casesDirectory: string;
  readonly caseId: string;
  readonly inputSelector?: string;
  readonly submitSelector?: string;
}

interface AnalysisOptions {
  readonly model: string;
  readonly reasoningEffort: ReasoningEffort;
  readonly runDirectory: string;
}

type RecordOptionsResult =
  | { readonly ok: true; readonly options: RecordOptions }
  | { readonly message: string; readonly ok: false };

type RunOptionsResult =
  | { readonly ok: true; readonly options: RunOptions }
  | { readonly message: string; readonly ok: false };

export async function runCli(
  arguments_: readonly string[],
  dependencies: CliDependencies,
): Promise<number> {
  const [command, ...options] = arguments_;
  const stderr = dependencies.stderr ?? dependencies.stdout;

  if (command === "analyze") return runAnalysis(options, dependencies, stderr);
  if (command === "run") return runDeclaredCase(options, dependencies, stderr);
  if (command !== "record") return reportUsage(stderr);

  const parsed = parseRecordOptions(options, dependencies.environment);
  if (!parsed.ok) {
    stderr(parsed.message);
    return 1;
  }

  dependencies.stdout(`Opening ${parsed.options.targetUrl}`);
  dependencies.stdout("Interact with Ask Maersk, then return here and press Enter to save evidence.");

  const result = await recordResearchSession(
    {
      outputRoot: parsed.options.outputRoot,
      targetUrl: parsed.options.targetUrl,
      userMessages: [parsed.options.userMessage],
      waitForCompletion: dependencies.waitForCompletion,
    },
    {
      browser: dependencies.browser,
      createRunId: dependencies.createRunId,
      now: dependencies.now,
    },
  );

  dependencies.stdout(`Evidence saved: ${result.runDirectory}`);
  return 0;
}

async function runAnalysis(
  arguments_: readonly string[],
  dependencies: CliDependencies,
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
  try {
    const evidence = JSON.parse(
      await readFile(join(parsed.options.runDirectory, "evidence.json"), "utf8"),
    ) as CaseEvidence;
    const finding = await analyzeEvidence(evidence, {
      analyzer: dependencies.createAnalyzer(apiKey),
      model: parsed.options.model,
      reasoningEffort: parsed.options.reasoningEffort,
    });
    await writeFile(findingPath, `${JSON.stringify(finding, null, 2)}\n`, { flag: "wx" });
    dependencies.stdout(`Finding saved: ${findingPath}`);
    dependencies.stdout(formatAnalysisUsage(finding));
    return 0;
  } catch (error: unknown) {
    stderr(`Analysis failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

type AnalysisOptionsResult =
  | { readonly ok: true; readonly options: AnalysisOptions }
  | { readonly message: string; readonly ok: false };

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

function isReasoningEffort(value: string): value is ReasoningEffort {
  return ["none", "low", "medium", "high", "xhigh"].includes(value);
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

async function runDeclaredCase(
  arguments_: readonly string[],
  dependencies: CliDependencies,
  stderr: (message: string) => void,
): Promise<number> {
  const parsed = parseRunOptions(arguments_, dependencies.environment);
  if (!parsed.ok) {
    stderr(parsed.message);
    return 1;
  }

  let cases: readonly ResearchCase[];
  try {
    cases = await loadResearchCases(parsed.options.casesDirectory);
  } catch (error: unknown) {
    stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
  const case_ = cases.find(({ id }) => id === parsed.options.caseId);
  if (typeof case_ === "undefined") {
    const available = cases.length === 0 ? "none" : cases.map(({ id }) => id).join(", ");
    stderr(
      `Research case "${parsed.options.caseId}" was not found in ${parsed.options.casesDirectory}. Available cases: ${available}.`,
    );
    return 1;
  }

  const interaction = resolveInteraction(case_, parsed.options);
  if (typeof interaction === "string") {
    stderr(interaction);
    return 1;
  }

  dependencies.stdout(`Running ${case_.id}: ${case_.objective}`);
  if (case_.executionMode === "manual") {
    dependencies.stdout(
      "Interact with Ask Maersk, then return here and press Enter to save evidence.",
    );
  }

  const result = await recordResearchSession(
    {
      captureTrace: case_.captureTrace,
      caseId: case_.id,
      interaction,
      outputRoot: parsed.options.outputRoot,
      targetUrl: parsed.options.targetUrl,
      userMessages: case_.messages.map(({ text }) => text),
      waitForCompletion: dependencies.waitForCompletion,
    },
    {
      browser: dependencies.browser,
      createRunId: dependencies.createRunId,
      now: dependencies.now,
    },
  );

  dependencies.stdout(`Evidence saved: ${result.runDirectory}`);
  return 0;
}

function resolveInteraction(
  case_: ResearchCase,
  options: RunOptions,
): NonNullable<Parameters<typeof recordResearchSession>[0]["interaction"]> | string {
  if (case_.executionMode === "manual") return { mode: "manual" };
  if (typeof options.inputSelector === "undefined" || options.inputSelector.length === 0) {
    return "Automated cases require ASK_MAERSK_INPUT_SELECTOR or --input-selector <selector>.";
  }
  return {
    inputSelector: options.inputSelector,
    mode: "automated",
    ...(typeof options.submitSelector === "undefined"
      ? {}
      : { submitSelector: options.submitSelector }),
  };
}

function parseRunOptions(
  arguments_: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
): RunOptionsResult {
  const [caseId, ...flags] = arguments_;
  if (typeof caseId === "undefined" || caseId.startsWith("--")) {
    return { ok: false, message: "Usage: pnpm research run <case-id> [options]" };
  }
  const parsedFlags = parseFlags(flags, [
    "--cases",
    "--input-selector",
    "--output",
    "--submit-selector",
    "--url",
  ]);
  if (!parsedFlags.ok) return parsedFlags;
  const common = resolveCommonOptions(parsedFlags.values, environment, undefined);
  if (!common.ok) return common;

  const inputSelector =
    parsedFlags.values.get("--input-selector") ?? environment.ASK_MAERSK_INPUT_SELECTOR;
  const submitSelector =
    parsedFlags.values.get("--submit-selector") ?? environment.ASK_MAERSK_SUBMIT_SELECTOR;
  return {
    ok: true,
    options: {
      ...common.options,
      caseId,
      casesDirectory:
        parsedFlags.values.get("--cases") ??
        environment.RESEARCH_CASES_DIR ??
        join(process.cwd(), "cases"),
      ...(typeof inputSelector === "undefined" ? {} : { inputSelector }),
      ...(typeof submitSelector === "undefined" ? {} : { submitSelector }),
    },
  };
}

function parseRecordOptions(
  arguments_: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
): RecordOptionsResult {
  const parsedFlags = parseFlags(arguments_, ["--message", "--output", "--url"]);
  if (!parsedFlags.ok) return parsedFlags;
  return resolveCommonOptions(
    parsedFlags.values,
    environment,
    parsedFlags.values.get("--message") ?? "Track my shipment",
  );
}

function resolveCommonOptions(
  values: ReadonlyMap<string, string>,
  environment: Readonly<Record<string, string | undefined>>,
  userMessage: string | undefined,
): RecordOptionsResult {

  const targetUrl = values.get("--url") ?? environment.ASK_MAERSK_URL;
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

  return {
    ok: true,
    options: {
      targetUrl: parsedUrl.toString(),
      outputRoot:
        values.get("--output") ?? environment.RESEARCH_OUTPUT_DIR ?? join(process.cwd(), "data", "runs"),
      userMessage: userMessage ?? "",
    },
  };
}

type FlagsResult =
  | { readonly ok: true; readonly values: ReadonlyMap<string, string> }
  | { readonly message: string; readonly ok: false };

function parseFlags(arguments_: readonly string[], allowed: readonly string[]): FlagsResult {
  const values = new Map<string, string>();
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

function reportUsage(stderr: (message: string) => void): 1 {
  stderr(
    "Usage: pnpm research <record [options] | run <case-id> [options] | analyze <run-directory> [options]>",
  );
  return 1;
}
