import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { Analyzer } from "../src/analysis/analyze-evidence.ts";
import { runCli } from "../src/cli/run-cli.ts";
import type { BrowserRecorder } from "../src/recording/record-research-session.ts";
import { createTemporaryDirectoryTracker } from "./support/temp-directories.ts";

const temporaryDirectories = createTemporaryDirectoryTracker();

afterEach(() => temporaryDirectories.cleanup());

describe("research CLI", () => {
  test("record creates evidence from environment configuration without an AI key", async () => {
    const outputRoot = await temporaryDirectories.create("maersk-research-cli-");
    const output: string[] = [];
    const browser: BrowserRecorder = {
      async capture(input) {
        expect(input.targetUrl).toBe("https://example.test/ask-maersk");
        await input.waitForCompletion();
        return {
          page: { url: input.targetUrl, title: "Ask Maersk" },
          conversation: [
            {
              index: 0,
              role: "user",
              text: "Track my shipment",
              timestamp: "2026-08-25T16:00:00.000Z",
            },
            {
              index: 1,
              role: "assistant",
              text: "Please provide a shipment identifier.",
              timestamp: "2026-08-25T16:00:01.000Z",
              screenshot: "screenshots/02-result.png",
            },
          ],
          screenshots: [
            { filename: "01-start.png", kind: "start", data: Buffer.from("start") },
            { filename: "02-result.png", kind: "result", data: Buffer.from("result") },
          ],
          network: [],
          timings: [{ turnIndex: 0, submittedAt: "2026-08-25T16:00:00.000Z" }],
          errors: [],
        };
      },
    };

    const exitCode = await runCli(["record"], {
      browser,
      createRunId: () => "cli-test",
      environment: {
        ASK_MAERSK_URL: "https://example.test/ask-maersk",
        RESEARCH_OUTPUT_DIR: outputRoot,
      },
      now: () => new Date("2026-08-25T16:00:00.000Z"),
      stdout: (message) => output.push(message),
      waitForCompletion: async () => undefined,
    });

    expect(exitCode).toBe(0);
    expect(output.join("\n")).toContain("2026-08-25_160000_cli-test");
    const evidence = await readFile(
      join(outputRoot, "2026-08-25_160000_cli-test", "evidence.json"),
      "utf8",
    );
    expect(evidence).toContain("Track my shipment");
  });

  test("record reports missing target configuration without launching a browser", async () => {
    const errors: string[] = [];
    const browser: BrowserRecorder = {
      async capture() {
        throw new Error("browser should not launch");
      },
    };

    const exitCode = await runCli(["record"], {
      browser,
      createRunId: () => "unused",
      environment: {},
      now: () => new Date("2026-08-25T16:00:00.000Z"),
      stderr: (message) => errors.push(message),
      stdout: () => undefined,
      waitForCompletion: async () => undefined,
    });

    expect(exitCode).toBe(1);
    expect(errors).toEqual([
      "ASK_MAERSK_URL is required. Set it in .env or pass --url <url>.",
    ]);
  });

  test("analyze exits clearly without an API key", async () => {
    const errors: string[] = [];
    const browser = createBrowser(async () => {
      throw new Error("browser should not launch");
    });

    const exitCode = await runCli(["analyze", "/tmp/a-recorded-run"], {
      browser,
      createRunId: () => "unused",
      environment: {},
      now: () => new Date("2026-08-25T16:00:00.000Z"),
      stderr: (message) => errors.push(message),
      stdout: () => undefined,
      waitForCompletion: async () => undefined,
    });

    expect(exitCode).toBe(1);
    expect(errors).toEqual([
      "OPEN_AI_API_KEY is required for analysis. Recording remains available without it.",
    ]);
  });

  test("analyze persists a validated finding with explicit model selection", async () => {
    const runDirectory = await temporaryDirectories.create("maersk-recorded-run-");
    await writeRecordedEvidence(runDirectory);
    const output: string[] = [];
    const requests: Parameters<Analyzer["analyze"]>[0][] = [];

    const exitCode = await runCli(
      [
        "analyze",
        runDirectory,
        "--model",
        "gpt-5-nano",
        "--reasoning-effort",
        "low",
      ],
      {
        browser: createBrowser(async () => {
          throw new Error("browser should not launch");
        }),
        createAnalyzer: (apiKey) => {
          expect(apiKey).toBe("test-api-key");
          return {
            async analyze(request) {
              requests.push(request);
              return {
                model: "gpt-5-nano",
                output: {
                  sourceRunId: "recorded-run",
                  behavior: {
                    classification: "clarification",
                    claim: "Ask Maersk requests a shipment identifier.",
                    evidenceReferences: [{ kind: "conversation", locator: "1" }],
                  },
                  apiCandidates: [],
                  askOneImplications: [
                    {
                      claim: "Ask ONE should collect the identifier before tracking.",
                      evidenceReferences: [{ kind: "conversation", locator: "1" }],
                    },
                  ],
                },
                usage: { inputTokens: 80, cachedInputTokens: 20, outputTokens: 30 },
              };
            },
          };
        },
        createRunId: () => "unused",
        environment: { OPEN_AI_API_KEY: "test-api-key" },
        now: () => new Date("2026-08-25T16:00:00.000Z"),
        stdout: (message) => output.push(message),
        waitForCompletion: async () => undefined,
      },
    );

    expect(exitCode).toBe(0);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ model: "gpt-5-nano", reasoningEffort: "low" });
    const finding = JSON.parse(
      await readFile(join(runDirectory, "finding.json"), "utf8"),
    ) as { analysis: { model: string; usage: { cachedInputTokens: number } } };
    expect(finding.analysis).toMatchObject({
      model: "gpt-5-nano",
      usage: { cachedInputTokens: 20 },
    });
    expect(output).toEqual([
      `Finding saved: ${join(runDirectory, "finding.json")}`,
      "Analysis: model=gpt-5-nano reasoning=low input=80 cached-input=20 output=30 reasoning-tokens=not-returned",
    ]);
  });

  test("analyze does not persist a finding with an unsupported evidence reference", async () => {
    const runDirectory = await temporaryDirectories.create("maersk-recorded-run-");
    await writeRecordedEvidence(runDirectory);
    const errors: string[] = [];

    const exitCode = await runCli(["analyze", runDirectory], {
      browser: createBrowser(async () => {
        throw new Error("browser should not launch");
      }),
      createAnalyzer: () => ({
        async analyze() {
          return {
            model: "gpt-5.4-mini",
            output: {
              sourceRunId: "recorded-run",
              behavior: {
                classification: "clarification",
                claim: "Ask Maersk requests a shipment identifier.",
                evidenceReferences: [{ kind: "network", locator: "invented-request" }],
              },
              apiCandidates: [],
              askOneImplications: [
                {
                  claim: "Ask ONE should collect an identifier first.",
                  evidenceReferences: [{ kind: "conversation", locator: "1" }],
                },
              ],
            },
          };
        },
      }),
      createRunId: () => "unused",
      environment: { OPEN_AI_API_KEY: "test-api-key" },
      now: () => new Date("2026-08-25T16:00:00.000Z"),
      stderr: (message) => errors.push(message),
      stdout: () => undefined,
      waitForCompletion: async () => undefined,
    });

    expect(exitCode).toBe(1);
    expect(errors[0]).toMatch(/unsupported evidence reference network:invented-request/u);
    await expect(readFile(join(runDirectory, "finding.json"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  test("analyze does not call the API when a finding already exists", async () => {
    const runDirectory = await temporaryDirectories.create("maersk-recorded-run-");
    await writeRecordedEvidence(runDirectory);
    await writeFile(join(runDirectory, "finding.json"), "existing finding\n");
    const errors: string[] = [];
    let analysisCalls = 0;

    const exitCode = await runCli(["analyze", runDirectory], {
      browser: createBrowser(async () => {
        throw new Error("browser should not launch");
      }),
      createAnalyzer: () => ({
        async analyze() {
          analysisCalls += 1;
          throw new Error("analysis should not run");
        },
      }),
      createRunId: () => "unused",
      environment: { OPEN_AI_API_KEY: "test-api-key" },
      now: () => new Date("2026-08-25T16:00:00.000Z"),
      stderr: (message) => errors.push(message),
      stdout: () => undefined,
      waitForCompletion: async () => undefined,
    });

    expect(exitCode).toBe(1);
    expect(analysisCalls).toBe(0);
    expect(errors).toEqual([
      `Analysis failed: Finding already exists: ${join(runDirectory, "finding.json")}.`,
    ]);
  });

  test("run executes a manual case by ID and persists case evidence", async () => {
    const casesDirectory = await temporaryDirectories.create("maersk-cases-");
    const outputRoot = await temporaryDirectories.create("maersk-research-cli-");
    await writeResearchCase(casesDirectory, {
      id: "TRACK-001",
      category: "TRACKING",
      objective: "Observe clarification",
      authenticated: false,
      executionMode: "manual",
      messages: [{ text: "Track my shipment" }],
      captureTrace: true,
      notes: "Use fake shipment data only",
    });
    let researcherReleasedRecording = false;
    const browser = createBrowser(async (input) => {
      expect(input.expectedUserMessages).toEqual(["Track my shipment"]);
      expect(input.captureTrace).toBe(true);
      expect(input.interaction).toEqual({ mode: "manual" });
      await input.waitForCompletion();
      expect(researcherReleasedRecording).toBe(true);
    });

    const exitCode = await runCli(["run", "TRACK-001"], {
      browser,
      createRunId: () => "manual-case",
      environment: {
        ASK_MAERSK_URL: "https://example.test/ask-maersk",
        RESEARCH_CASES_DIR: casesDirectory,
        RESEARCH_OUTPUT_DIR: outputRoot,
      },
      now: () => new Date("2026-08-25T16:00:00.000Z"),
      stdout: () => undefined,
      waitForCompletion: async () => {
        researcherReleasedRecording = true;
      },
    });

    expect(exitCode).toBe(0);
    const runDirectory = join(outputRoot, "2026-08-25_160000_manual-case");
    const evidence = JSON.parse(
      await readFile(join(runDirectory, "evidence.json"), "utf8"),
    ) as { caseId?: string; trace?: { path: string } };
    expect(evidence.caseId).toBe("TRACK-001");
    expect(evidence.trace).toEqual({ path: "trace/trace.zip" });
    expect(await readFile(join(runDirectory, "trace/trace.zip"), "utf8")).toBe("trace");
  });

  test("run configures automated interaction from stable selectors", async () => {
    const casesDirectory = await temporaryDirectories.create("maersk-cases-");
    const outputRoot = await temporaryDirectories.create("maersk-research-cli-");
    await writeResearchCase(casesDirectory, {
      id: "CAPABILITY-001",
      category: "CAPABILITY",
      objective: "Observe the opening capability answer",
      executionMode: "automated",
      messages: [
        { text: "What can you help me with?" },
        { text: "Now help me track a shipment" },
      ],
    });
    const browser = createBrowser(async (input) => {
      expect(input.expectedUserMessages).toEqual([
        "What can you help me with?",
        "Now help me track a shipment",
      ]);
      expect(input.interaction).toEqual({
        inputSelector: "[data-testid=question]",
        mode: "automated",
        submitSelector: "[data-testid=send]",
      });
    });

    const exitCode = await runCli(["run", "CAPABILITY-001"], {
      browser,
      createRunId: () => "automated-case",
      environment: {
        ASK_MAERSK_INPUT_SELECTOR: "[data-testid=question]",
        ASK_MAERSK_SUBMIT_SELECTOR: "[data-testid=send]",
        ASK_MAERSK_URL: "https://example.test/ask-maersk",
        RESEARCH_CASES_DIR: casesDirectory,
        RESEARCH_OUTPUT_DIR: outputRoot,
      },
      now: () => new Date("2026-08-25T16:00:00.000Z"),
      stdout: () => undefined,
      waitForCompletion: async () => {
        throw new Error("automated execution must not wait for researcher input");
      },
    });

    expect(exitCode).toBe(0);
  });

  test("run reports a missing case without launching the browser", async () => {
    const casesDirectory = await temporaryDirectories.create("maersk-cases-");
    await writeResearchCase(casesDirectory, {
      id: "TRACK-001",
      category: "TRACKING",
      objective: "Observe tracking",
      executionMode: "manual",
      messages: [{ text: "Track my shipment" }],
    });
    const errors: string[] = [];
    const browser = createBrowser(async () => {
      throw new Error("browser should not launch");
    });

    const exitCode = await runCli(["run", "MISSING-001"], {
      browser,
      createRunId: () => "unused",
      environment: {
        ASK_MAERSK_URL: "https://example.test/ask-maersk",
        RESEARCH_CASES_DIR: casesDirectory,
      },
      now: () => new Date("2026-08-25T16:00:00.000Z"),
      stderr: (message) => errors.push(message),
      stdout: () => undefined,
      waitForCompletion: async () => undefined,
    });

    expect(exitCode).toBe(1);
    expect(errors).toEqual([
      `Research case "MISSING-001" was not found in ${casesDirectory}. Available cases: TRACK-001.`,
    ]);
  });

  test("run rejects an invalid case before launching the browser", async () => {
    const casesDirectory = await temporaryDirectories.create("maersk-cases-");
    await writeResearchCase(casesDirectory, {
      id: "TRACK-001",
      category: "TRACKING",
      objective: "Observe tracking",
      executionMode: "manual",
      messages: [],
    });
    const errors: string[] = [];
    const browser = createBrowser(async () => {
      throw new Error("browser should not launch");
    });

    const exitCode = await runCli(["run", "TRACK-001"], {
      browser,
      createRunId: () => "unused",
      environment: {
        ASK_MAERSK_URL: "https://example.test/ask-maersk",
        RESEARCH_CASES_DIR: casesDirectory,
      },
      now: () => new Date("2026-08-25T16:00:00.000Z"),
      stderr: (message) => errors.push(message),
      stdout: () => undefined,
      waitForCompletion: async () => undefined,
    });

    expect(exitCode).toBe(1);
    expect(errors[0]).toMatch(
      /Invalid research case TRACK-001\.json: messages: must contain at least one message/u,
    );
  });

  test("run rejects duplicate IDs before launching the browser", async () => {
    const casesDirectory = await temporaryDirectories.create("maersk-cases-");
    const duplicate = {
      id: "TRACK-001",
      category: "TRACKING",
      objective: "Observe tracking",
      executionMode: "manual",
      messages: [{ text: "Track my shipment" }],
    };
    await writeResearchCase(casesDirectory, duplicate);
    await writeFile(join(casesDirectory, "duplicate.json"), JSON.stringify(duplicate));
    const errors: string[] = [];
    const browser = createBrowser(async () => {
      throw new Error("browser should not launch");
    });

    const exitCode = await runCli(["run", "TRACK-001"], {
      browser,
      createRunId: () => "unused",
      environment: {
        ASK_MAERSK_URL: "https://example.test/ask-maersk",
        RESEARCH_CASES_DIR: casesDirectory,
      },
      now: () => new Date("2026-08-25T16:00:00.000Z"),
      stderr: (message) => errors.push(message),
      stdout: () => undefined,
      waitForCompletion: async () => undefined,
    });

    expect(exitCode).toBe(1);
    expect(errors).toEqual([
      'Duplicate research case ID "TRACK-001" in TRACK-001.json and duplicate.json.',
    ]);
  });

  test("corpus runs a category, continues after failure, and writes an aggregate summary", async () => {
    const casesDirectory = await temporaryDirectories.create("maersk-cases-");
    const outputRoot = await temporaryDirectories.create("maersk-corpus-runs-");
    const summaryRoot = await temporaryDirectories.create("maersk-corpus-summaries-");
    for (const id of ["TRACK-002", "TRACK-001", "TRACK-003"]) {
      await writeResearchCase(casesDirectory, {
        id,
        category: "TRACKING",
        objective: `Observe ${id}`,
        executionMode: "automated",
        messages: [{ text: `Track fake identifier ${id}` }],
      });
    }
    let captureCount = 0;
    const browser: BrowserRecorder = {
      async capture(input) {
        captureCount += 1;
        if (captureCount === 2) throw new Error("browser unavailable");
        return createBrowser(async () => undefined).capture(input);
      },
    };
    let id = 0;
    const output: string[] = [];

    const exitCode = await runCli(["corpus", "--category", "TRACKING"], {
      browser,
      createAnalyzer: () => ({
        async analyze(request) {
          return {
            model: request.model,
            output: {
              sourceRunId: request.evidence.runId,
              behavior: {
                classification: "clarification",
                claim: "Ask Maersk requests a shipment identifier.",
                evidenceReferences: [{ kind: "conversation", locator: "1" }],
              },
              apiCandidates: [],
              askOneImplications: [
                {
                  claim: "Ask ONE should collect an identifier first.",
                  evidenceReferences: [{ kind: "conversation", locator: "1" }],
                },
              ],
            },
            usage: { inputTokens: 50, outputTokens: 10 },
          };
        },
      }),
      createCorpusRunId: () => "tracking-corpus",
      createRunId: () => `case-${++id}`,
      environment: {
        ASK_MAERSK_INPUT_SELECTOR: "[data-testid=question]",
        ASK_MAERSK_URL: "https://example.test/ask-maersk",
        OPEN_AI_API_KEY: "test-api-key",
        RESEARCH_CASES_DIR: casesDirectory,
        RESEARCH_CORPUS_OUTPUT_DIR: summaryRoot,
        RESEARCH_OUTPUT_DIR: outputRoot,
      },
      now: () => new Date("2026-08-26T08:00:00.000Z"),
      stdout: (message) => output.push(message),
      waitForCompletion: async () => undefined,
    });

    expect(exitCode).toBe(1);
    const summaryPath = join(
      summaryRoot,
      "2026-08-26_080000_tracking-corpus",
      "summary.json",
    );
    const summary = JSON.parse(await readFile(summaryPath, "utf8")) as {
      aggregateUsage: { inputTokens: number; outputTokens: number };
      cases: { caseId: string; status: string; evidencePath?: string; findingPath?: string }[];
    };
    expect(summary.cases.map(({ caseId, status }) => [caseId, status])).toEqual([
      ["TRACK-001", "completed"],
      ["TRACK-002", "failed"],
      ["TRACK-003", "completed"],
    ]);
    expect(summary.cases[0]?.evidencePath).toMatch(/evidence\.json$/u);
    expect(summary.cases[0]?.findingPath).toMatch(/finding\.json$/u);
    expect(summary.aggregateUsage).toEqual({ inputTokens: 100, outputTokens: 20 });
    expect(output).toContain(`Corpus summary saved: ${summaryPath}`);
  });

  test("corpus captures every eligible case without creating an analyzer or requiring an API key", async () => {
    const outputRoot = await temporaryDirectories.create("maersk-capture-runs-");
    const summaryRoot = await temporaryDirectories.create("maersk-capture-summaries-");
    const output: string[] = [];
    let analyzerCreations = 0;
    let runId = 0;

    const exitCode = await runCli(["corpus", "--all", "--capture-only"], {
      browser: createBrowser(async () => undefined),
      createAnalyzer: () => {
        analyzerCreations += 1;
        throw new Error("capture-only must not create an analyzer");
      },
      createCorpusRunId: () => "all-capture",
      createRunId: () => `capture-${++runId}`,
      environment: {
        ASK_MAERSK_INPUT_SELECTOR: "[data-testid=question]",
        ASK_MAERSK_URL: "https://example.test/ask-maersk",
        RESEARCH_CASES_DIR: join(process.cwd(), "cases"),
        RESEARCH_CORPUS_OUTPUT_DIR: summaryRoot,
        RESEARCH_OUTPUT_DIR: outputRoot,
      },
      now: () => new Date("2026-08-26T09:00:00.000Z"),
      stdout: (message) => output.push(message),
      waitForCompletion: async () => {
        throw new Error("capture-only all must not wait for terminal input");
      },
    });

    expect(exitCode).toBe(0);
    expect(analyzerCreations).toBe(0);
    const summaryPath = join(
      summaryRoot,
      "2026-08-26_090000_all-capture",
      "summary.json",
    );
    const summary = JSON.parse(await readFile(summaryPath, "utf8")) as {
      aggregateUsage?: unknown;
      analysisPolicy?: unknown;
      cases: { caseId: string; evidencePath?: string; findingPath?: string; status: string }[];
      mode: string;
      schemaVersion: number;
      selection: unknown;
    };
    expect(summary).toMatchObject({
      schemaVersion: 2,
      mode: "capture-only",
      selection: { all: true },
    });
    expect(summary.analysisPolicy).toBeUndefined();
    expect(summary.aggregateUsage).toBeUndefined();
    expect(summary.cases).toHaveLength(21);
    expect(summary.cases.some(({ status }) => status === "captured")).toBe(true);
    expect(summary.cases.some(({ status }) => status === "skipped")).toBe(true);
    expect(summary.cases.some(({ status }) => status === "preflight-required")).toBe(true);
    expect(summary.cases.every(({ findingPath }) => typeof findingPath === "undefined")).toBe(true);
    expect(summary.cases[0]?.caseId).toBe("AUTH-001");
    expect(summary.cases.at(-1)?.caseId).toBe("TRACKING-003");
    expect(output).toContain(`Corpus summary saved: ${summaryPath}`);
    expect(output).toContain(
      `Next paid step (CAPABILITY-001): pnpm research analyze ${join(outputRoot, "2026-08-26_090000_capture-1")}`,
    );
  });

  test("capture-only resume preserves captured evidence and retries capture failures", async () => {
    const casesDirectory = await temporaryDirectories.create("maersk-capture-cases-");
    const outputRoot = await temporaryDirectories.create("maersk-capture-evidence-");
    const summaryRoot = await temporaryDirectories.create("maersk-capture-resume-");
    for (const id of ["TRACK-001", "TRACK-002"]) {
      await writeResearchCase(casesDirectory, {
        id,
        category: "TRACKING",
        objective: `Capture ${id}`,
        executionMode: "automated",
        messages: [{ text: `Prompt ${id}` }],
      });
    }
    const common = {
      createRunId: (() => {
        let id = 0;
        return () => `evidence-${++id}`;
      })(),
      environment: {
        ASK_MAERSK_INPUT_SELECTOR: "[data-testid=question]",
        ASK_MAERSK_URL: "https://example.test/ask-maersk",
        RESEARCH_CASES_DIR: casesDirectory,
        RESEARCH_CORPUS_OUTPUT_DIR: summaryRoot,
        RESEARCH_OUTPUT_DIR: outputRoot,
      },
      now: () => new Date("2026-08-26T10:00:00.000Z"),
      stdout: () => undefined,
      waitForCompletion: async () => undefined,
    };
    const firstExit = await runCli(
      ["corpus", "--category", "TRACKING", "--capture-only"],
      {
        ...common,
        browser: createBrowser(async ({ expectedUserMessages }) => {
          if (expectedUserMessages[0] === "Prompt TRACK-002") {
            throw new Error("temporary browser failure");
          }
        }),
        createCorpusRunId: () => "first-capture",
      },
    );
    const firstSummaryPath = join(
      summaryRoot,
      "2026-08-26_100000_first-capture",
      "summary.json",
    );
    const firstSummaryBeforeResume = await readFile(firstSummaryPath, "utf8");
    const firstSummary = JSON.parse(firstSummaryBeforeResume) as {
      cases: { caseId: string; status: string }[];
    };

    expect(firstExit).toBe(1);
    expect(firstSummary.cases.map(({ caseId, status }) => [caseId, status])).toEqual([
      ["TRACK-001", "captured"],
      ["TRACK-002", "capture-failed"],
    ]);

    const retriedPrompts: string[] = [];
    const resumedExit = await runCli(
      [
        "corpus",
        "--category",
        "TRACKING",
        "--capture-only",
        "--resume",
        firstSummaryPath,
      ],
      {
        ...common,
        browser: createBrowser(async ({ expectedUserMessages }) => {
          retriedPrompts.push(expectedUserMessages[0] ?? "");
        }),
        createCorpusRunId: () => "resumed-capture",
      },
    );
    const resumedSummaryPath = join(
      summaryRoot,
      "2026-08-26_100000_resumed-capture",
      "summary.json",
    );
    const resumedSummary = JSON.parse(await readFile(resumedSummaryPath, "utf8")) as {
      cases: { caseId: string; resumed?: boolean; status: string }[];
      resumedFrom: string;
    };

    expect(resumedExit).toBe(0);
    expect(retriedPrompts).toEqual(["Prompt TRACK-002"]);
    expect(resumedSummary.cases).toMatchObject([
      { caseId: "TRACK-001", status: "captured", resumed: true },
      { caseId: "TRACK-002", status: "captured" },
    ]);
    expect(resumedSummary.resumedFrom).toBe(firstSummaryPath);
    expect(await readFile(firstSummaryPath, "utf8")).toBe(firstSummaryBeforeResume);
  });
});

type CaptureInput = Parameters<BrowserRecorder["capture"]>[0];

function createBrowser(beforeCapture: (input: CaptureInput) => Promise<void>): BrowserRecorder {
  return {
    async capture(input) {
      await beforeCapture(input);
      return {
        page: { url: input.targetUrl, title: "Ask Maersk" },
        conversation: [
          {
            index: 0,
            role: "user",
            text: input.expectedUserMessages[0] ?? "",
            timestamp: "2026-08-25T16:00:00.000Z",
          },
          {
            index: 1,
            role: "assistant",
            text: "Please provide a shipment identifier.",
            timestamp: "2026-08-25T16:00:01.000Z",
          },
        ],
        screenshots: [],
        network: [],
        timings: [{ turnIndex: 0, submittedAt: "2026-08-25T16:00:00.000Z" }],
        errors: [],
        ...(input.captureTrace === true
          ? { trace: { filename: "trace.zip", data: Buffer.from("trace") } }
          : {}),
      };
    },
  };
}

async function writeResearchCase(
  casesDirectory: string,
  researchCase: Readonly<Record<string, unknown>>,
): Promise<void> {
  await writeFile(join(casesDirectory, `${String(researchCase.id)}.json`), JSON.stringify(researchCase));
}

async function writeRecordedEvidence(runDirectory: string): Promise<void> {
  await writeFile(
    join(runDirectory, "evidence.json"),
    JSON.stringify({
      runId: "recorded-run",
      startedAt: "2026-08-25T16:00:00.000Z",
      completedAt: "2026-08-25T16:00:02.000Z",
      conversation: [
        {
          index: 0,
          role: "user",
          text: "Track my shipment",
          timestamp: "2026-08-25T16:00:00.000Z",
        },
        {
          index: 1,
          role: "assistant",
          text: "Please provide a shipment identifier.",
          timestamp: "2026-08-25T16:00:01.000Z",
        },
      ],
      screenshots: [],
      network: [],
      timings: [],
      page: { url: "https://example.test/ask-maersk", title: "Ask Maersk" },
      errors: [],
    }),
  );
}
