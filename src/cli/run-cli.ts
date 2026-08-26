import { join } from "node:path";
import { loadResearchCases } from "../cases/load-research-cases.ts";
import { resolveCaseInteraction } from "../cases/resolve-case-interaction.ts";
import type { ResearchCase } from "../domain/research-case.ts";
import {
  recordResearchSession,
  type BrowserRecorder,
} from "../recording/record-research-session.ts";
import { runAnalysis, type AnalysisCliDependencies } from "./analyze-run.ts";
import { parseFlags } from "./parse-flags.ts";
import { runCorpus, type CorpusCliDependencies } from "./run-corpus.ts";
import { runPreflight } from "./run-preflight.ts";
import { runReport } from "./run-report.ts";

export interface CliDependencies extends AnalysisCliDependencies, CorpusCliDependencies {
  readonly browser: BrowserRecorder;
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
  if (command === "corpus") return runCorpus(options, dependencies, stderr);
  if (command === "preflight") return runPreflight(options, dependencies, stderr);
  if (command === "report") return runReport(options, dependencies, stderr);
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
  if (case_.executionMode === "automated" && case_.dataPolicy === "authorized") {
    return "Authorized-data automation is available only through capture-only corpus execution with --allow-authorized-data and --test-data <path>.";
  }
  const interaction = resolveCaseInteraction(case_, options);
  if (typeof interaction === "undefined") {
    return "Automated cases require ASK_MAERSK_INPUT_SELECTOR or --input-selector <selector>.";
  }
  return interaction;
}

function parseRunOptions(
  arguments_: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
): RunOptionsResult {
  const [caseId, ...flags] = arguments_;
  if (typeof caseId === "undefined" || caseId.startsWith("--")) {
    return { ok: false, message: "Usage: pnpm research run <case-id> [options]" };
  }
  const parsedFlags = parseFlags(flags, {
    "--cases": "value",
    "--input-selector": "value",
    "--output": "value",
    "--submit-selector": "value",
    "--url": "value",
  });
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
  const parsedFlags = parseFlags(arguments_, {
    "--message": "value",
    "--output": "value",
    "--url": "value",
  });
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

function reportUsage(stderr: (message: string) => void): 1 {
  stderr(
    "Usage: pnpm research <record [options] | run <case-id> [options] | preflight <--all | --case id | --category category> [options] | analyze <run-directory> [options] | corpus <--all --capture-only | --case id | --category category> [options] | report <corpus-summary> [options]>",
  );
  return 1;
}
