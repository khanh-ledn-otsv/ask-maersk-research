import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { Analyzer } from "../src/analysis/analyze-evidence.ts";
import { executeCorpusCase } from "../src/corpus/execute-corpus-case.ts";
import type { ResearchCase } from "../src/domain/research-case.ts";
import type { BrowserRecorder } from "../src/recording/record-research-session.ts";
import { sequenceClock } from "./support/sequence-clock.ts";
import { createTemporaryDirectoryTracker } from "./support/temp-directories.ts";

const temporaryDirectories = createTemporaryDirectoryTracker();

afterEach(() => temporaryDirectories.cleanup());

describe("executeCorpusCase", () => {
  test("captures evidence and writes a cited finding with the requested cost policy", async () => {
    const outputRoot = await temporaryDirectories.create("maersk-corpus-case-");
    const requests: Parameters<Analyzer["analyze"]>[0][] = [];

    const result = await executeCorpusCase(
      automatedCase,
      { model: "gpt-5-nano", reasoningEffort: "low" },
      executionOptions(outputRoot),
      {
        analyzer: analyzer(requests),
        browser: browser(),
        createRunId: () => "case-run",
        now: sequenceClock(
          "2026-08-26T07:00:00.000Z",
          "2026-08-26T07:00:02.000Z",
        ),
      },
    );

    expect(result).toMatchObject({
      status: "completed",
      usage: { inputTokens: 80, outputTokens: 20 },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ model: "gpt-5-nano", reasoningEffort: "low" });
    if (result.status !== "completed") throw new Error("expected completion");
    expect(JSON.parse(await readFile(result.findingPath, "utf8"))).toMatchObject({
      sourceRunId: "2026-08-26_070000_case-run",
      analysis: { model: "gpt-5-nano", reasoningEffort: "low" },
    });
    expect(result.evidencePath).toBe(
      join(outputRoot, "2026-08-26_070000_case-run", "evidence.json"),
    );
  });

  test("keeps the evidence link when analysis fails", async () => {
    const outputRoot = await temporaryDirectories.create("maersk-corpus-case-");
    const result = await executeCorpusCase(
      automatedCase,
      { model: "gpt-5.4-mini", reasoningEffort: "none" },
      executionOptions(outputRoot),
      {
        analyzer: {
          async analyze() {
            throw new Error("analysis unavailable");
          },
        },
        browser: browser(),
        createRunId: () => "partial-run",
        now: sequenceClock(
          "2026-08-26T07:00:00.000Z",
          "2026-08-26T07:00:02.000Z",
        ),
      },
    );

    expect(result).toEqual({
      status: "failed",
      error: "analysis unavailable",
      evidencePath: join(outputRoot, "2026-08-26_070000_partial-run", "evidence.json"),
    });
    if (result.status !== "failed") throw new Error("expected failure");
    await expect(readFile(result.evidencePath!, "utf8")).resolves.toContain(automatedCase.id);
  });
});

const automatedCase: ResearchCase = {
  id: "CAPABILITY-001",
  category: "CAPABILITY",
  objective: "Observe advertised capabilities",
  authenticated: false,
  dataPolicy: "public",
  executionMode: "automated",
  messages: [{ text: "What can you help me with?" }],
  captureTrace: false,
};

function executionOptions(outputRoot: string) {
  return {
    interaction: { inputSelector: "[data-testid=question]", mode: "automated" as const },
    outputRoot,
    targetUrl: "https://example.test/ask-maersk",
    waitForCompletion: async () => undefined,
  };
}

function browser(): BrowserRecorder {
  return {
    async capture(input) {
      return {
        page: { url: input.targetUrl, title: "Ask Maersk" },
        conversation: [
          {
            index: 0,
            role: "user",
            text: input.expectedUserMessages[0]!,
            timestamp: "2026-08-26T07:00:00.000Z",
          },
          {
            index: 1,
            role: "assistant",
            text: "I can help with tracking and schedules.",
            timestamp: "2026-08-26T07:00:01.000Z",
          },
        ],
        screenshots: [],
        network: [],
        timings: [{ turnIndex: 0, submittedAt: "2026-08-26T07:00:00.000Z" }],
        errors: [],
      };
    },
  };
}

function analyzer(requests: Parameters<Analyzer["analyze"]>[0][]): Analyzer {
  return {
    async analyze(request) {
      requests.push(request);
      return {
        model: request.model,
        output: {
          sourceRunId: request.evidence.runId,
          behavior: {
            classification: "direct-answer",
            claim: "Ask Maersk describes supported tasks.",
            evidenceReferences: [{ kind: "conversation", locator: "1" }],
          },
          apiCandidates: [],
          askOneImplications: [
            {
              claim: "Ask ONE should expose a capability overview.",
              evidenceReferences: [{ kind: "conversation", locator: "1" }],
            },
          ],
        },
        usage: { inputTokens: 80, outputTokens: 20 },
      };
    },
  };
}
