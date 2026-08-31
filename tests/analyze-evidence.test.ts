import { describe, expect, test } from "vitest";
import {
  analyzeEvidence,
  type AnalysisRequest,
  type Analyzer,
  type AnalyzerResponse,
} from "../src/analysis/analyze-evidence.ts";
import type { CaseEvidence } from "../src/domain/evidence.ts";

describe("evidence analysis", () => {
  test("returns a cited finding with transparent model usage", async () => {
    const analyzer = createAnalyzer({
      model: "gpt-5.4-mini-2026-03-17",
      output: validOutput,
      usage: {
        cachedInputTokens: 120,
        inputTokens: 900,
        outputTokens: 240,
        reasoningTokens: 40,
      },
    });

    const finding = await analyzeEvidence(evidence, { analyzer });

    expect(finding).toEqual({
      ...validOutput,
      analysis: {
        model: "gpt-5.4-mini-2026-03-17",
        reasoningEffort: "none",
        usage: {
          cachedInputTokens: 120,
          inputTokens: 900,
          outputTokens: 240,
          reasoningTokens: 40,
        },
      },
      schemaVersion: 1,
    });
    expect(analyzer.requests).toEqual([
      {
        evidence,
        model: "gpt-5.4-mini",
        reasoningEffort: "none",
      },
    ]);
  });

  test("rejects malformed structured output", async () => {
    const analyzer = createAnalyzer({
      model: "gpt-5.4-mini",
      output: {
        sourceRunId: evidence.runId,
        behavior: validOutput.behavior,
        apiCandidates: [],
      },
    });

    await expect(analyzeEvidence(evidence, { analyzer })).rejects.toThrow(
      /Analyzer returned an invalid finding/u,
    );
  });

  test.each([
    {
      name: "missing",
      output: {
        ...validOutput,
        behavior: { ...validOutput.behavior, evidenceReferences: [] },
      },
    },
    {
      name: "unknown",
      output: {
        ...validOutput,
        behavior: {
          ...validOutput.behavior,
          evidenceReferences: [{ kind: "network", locator: "request-missing" }],
        },
      },
    },
    {
      name: "mismatched",
      output: { ...validOutput, sourceRunId: "another-run" },
    },
  ])("rejects $name evidence references", async ({ output }) => {
    const analyzer = createAnalyzer({ model: "gpt-5.4-mini", output });

    await expect(analyzeEvidence(evidence, { analyzer })).rejects.toThrow(
      /Analyzer returned an invalid finding|unsupported evidence reference/u,
    );
  });

  test("surfaces analyzer API errors", async () => {
    const analyzer: Analyzer = {
      async analyze() {
        throw new Error("OpenAI request failed: rate limit exceeded");
      },
    };

    await expect(analyzeEvidence(evidence, { analyzer })).rejects.toThrow(
      "OpenAI request failed: rate limit exceeded",
    );
  });

  test("uses an explicitly selected model and reasoning effort without fallback", async () => {
    const analyzer = createAnalyzer({ model: "gpt-5-nano", output: validOutput });

    const finding = await analyzeEvidence(evidence, {
      analyzer,
      model: "gpt-5-nano",
      reasoningEffort: "low",
    });

    expect(analyzer.requests[0]).toMatchObject({
      model: "gpt-5-nano",
      reasoningEffort: "low",
    });
    expect(finding.analysis).toEqual({
      model: "gpt-5-nano",
      reasoningEffort: "low",
    });
  });

  test("normalizes a redundant evidence kind prefix in structured locators", async () => {
    const analyzer = createAnalyzer({
      model: "gpt-5.4-mini",
      output: {
        ...validOutput,
        behavior: {
          ...validOutput.behavior,
          evidenceReferences: [{ kind: "conversation", locator: "conversation:1" }],
        },
      },
    });

    const finding = await analyzeEvidence(evidence, { analyzer });

    expect(finding.behavior.evidenceReferences).toEqual([
      { kind: "conversation", locator: "1" },
    ]);
  });

  test("normalizes a numeric network locator to the captured request id", async () => {
    const analyzer = createAnalyzer({
      model: "gpt-5.4-mini",
      output: {
        ...validOutput,
        apiCandidates: [
          {
            ...validOutput.apiCandidates[0],
            evidenceReferences: [{ kind: "network", locator: "1" }],
          },
        ],
      },
    });

    const finding = await analyzeEvidence(evidence, { analyzer });

    expect(finding.apiCandidates[0]?.evidenceReferences).toEqual([
      { kind: "network", locator: "request-1" },
    ]);
  });
});

const evidence = {
  runId: "2026-08-25_160000_tracking",
  caseId: "TRACK-001",
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
      screenshot: "screenshots/02-result.png",
    },
  ],
  screenshots: [
    { path: "screenshots/01-start.png", kind: "start" },
    { path: "screenshots/02-result.png", kind: "result" },
  ],
  network: [
    {
      id: "request-1",
      timestamp: "2026-08-25T16:00:00.100Z",
      method: "POST",
      url: "https://example.test/api/chat",
      resourceType: "fetch",
      status: 200,
    },
  ],
  timings: [{ turnIndex: 0, submittedAt: "2026-08-25T16:00:00.000Z" }],
  page: { url: "https://example.test/ask-maersk", title: "Ask Maersk" },
  errors: [],
} satisfies CaseEvidence;

const validOutput = {
  sourceRunId: evidence.runId,
  behavior: {
    classification: "clarification",
    claim: "Ask Maersk asks for a shipment identifier before tracking.",
    evidenceReferences: [
      { kind: "conversation", locator: "1" },
      { kind: "screenshot", locator: "screenshots/02-result.png" },
    ],
  },
  apiCandidates: [
    {
      name: "Chat request endpoint",
      rationale: "A correlated POST request completed while the answer was produced.",
      confidence: "medium",
      evidenceReferences: [{ kind: "network", locator: "request-1" }],
    },
  ],
  askOneImplications: [
    {
      claim: "Ask ONE should prompt for a shipment identifier before calling tracking APIs.",
      evidenceReferences: [{ kind: "conversation", locator: "1" }],
    },
  ],
} as const;

function createAnalyzer(response: AnalyzerResponse): Analyzer & { requests: AnalysisRequest[] } {
  const requests: AnalysisRequest[] = [];
  return {
    requests,
    async analyze(request) {
      requests.push(request);
      return response;
    },
  };
}
