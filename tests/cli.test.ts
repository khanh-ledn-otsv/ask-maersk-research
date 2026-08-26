import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
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
