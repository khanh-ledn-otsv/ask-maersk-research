import "dotenv/config";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stderr, stdout } from "node:process";
import pino from "pino";
import { createOpenAIEvidenceAnalyzer } from "./analysis/openai-evidence-analyzer.ts";
import { createPlaywrightBrowserRecorder } from "./browser/playwright-browser-recorder.ts";
import { runCli } from "./cli/run-cli.ts";

const terminal = createInterface({ input: stdin, output: stdout });
const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });
const userDataDirectory =
  process.env.RESEARCH_BROWSER_PROFILE_DIR ?? join(process.cwd(), ".research", "browser-profile");
const assistantSelector = process.env.ASK_MAERSK_ASSISTANT_SELECTOR;
const loadingSelector = process.env.ASK_MAERSK_LOADING_SELECTOR;
const browser = createPlaywrightBrowserRecorder({
  userDataDirectory,
  headless: process.env.RESEARCH_HEADLESS === "true",
  ...(typeof assistantSelector === "undefined" ? {} : { assistantSelector }),
  ...(typeof loadingSelector === "undefined" ? {} : { loadingSelector }),
});
const browserPreflight = createPlaywrightBrowserRecorder({
  userDataDirectory,
  headless: false,
  ...(typeof assistantSelector === "undefined" ? {} : { assistantSelector }),
  ...(typeof loadingSelector === "undefined" ? {} : { loadingSelector }),
});

try {
  process.exitCode = await runCli(process.argv.slice(2), {
    browser,
    browserPreflight,
    createAnalyzer: createOpenAIEvidenceAnalyzer,
    createCorpusRunId: () => randomUUID().slice(0, 8),
    createRunId: () => randomUUID().slice(0, 8),
    environment: process.env,
    now: () => new Date(),
    stderr: (message) => stderr.write(`${message}\n`),
    stdout: (message) => stdout.write(`${message}\n`),
    waitForCompletion: async () => {
      await terminal.question("");
    },
  });
} catch (error: unknown) {
  logger.error({ error }, "Research recording failed");
  process.exitCode = 1;
} finally {
  terminal.close();
}
