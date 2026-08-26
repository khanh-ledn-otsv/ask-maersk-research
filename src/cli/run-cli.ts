import { join } from "node:path";
import {
  recordResearchSession,
  type BrowserRecorder,
} from "../recording/record-research-session.ts";

export interface CliDependencies {
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

type RecordOptionsResult =
  | { readonly ok: true; readonly options: RecordOptions }
  | { readonly message: string; readonly ok: false };

export async function runCli(
  arguments_: readonly string[],
  dependencies: CliDependencies,
): Promise<number> {
  const [command, ...options] = arguments_;
  const stderr = dependencies.stderr ?? dependencies.stdout;

  if (command !== "record") {
    stderr("Usage: pnpm research record [--url <url>] [--output <directory>] [--message <text>]");
    return 1;
  }

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
      userMessage: parsed.options.userMessage,
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

function parseRecordOptions(
  arguments_: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
): RecordOptionsResult {
  const values = new Map<string, string>();

  for (let index = 0; index < arguments_.length; index += 2) {
    const flag = arguments_[index];
    const value = arguments_[index + 1];
    if (typeof flag === "undefined" || typeof value === "undefined") {
      return { ok: false, message: `Missing value for ${flag ?? "option"}.` };
    }
    if (flag !== "--url" && flag !== "--output" && flag !== "--message") {
      return { ok: false, message: `Unknown option: ${flag}` };
    }
    values.set(flag, value);
  }

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
      userMessage: values.get("--message") ?? "Track my shipment",
    },
  };
}
