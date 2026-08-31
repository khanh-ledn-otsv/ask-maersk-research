import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { Analyzer, Finding } from "../src/analysis/analyze-evidence.ts";
import { runCli } from "../src/cli/run-cli.ts";
import type { CaseEvidence } from "../src/domain/evidence.ts";
import type { BrowserRecorder } from "../src/recording/record-research-session.ts";
import { createTemporaryDirectoryTracker } from "./support/temp-directories.ts";

const temporaryDirectories = createTemporaryDirectoryTracker();

afterEach(() => temporaryDirectories.cleanup());

describe("analyze-corpus CLI", () => {
  test("converts a capture summary into a report-ready analyzed summary and reuses findings", async () => {
    const root = await temporaryDirectories.create("maersk-analyze-corpus-");
    const summaryOutputRoot = join(root, "corpus-runs");
    const firstRun = join(root, "runs", "first");
    const secondRun = join(root, "runs", "second");
    await Promise.all([
      mkdir(firstRun, { recursive: true }),
      mkdir(secondRun, { recursive: true }),
      mkdir(summaryOutputRoot, { recursive: true }),
    ]);
    const firstEvidence = evidence("first-run", "What can you help with?");
    const secondEvidence = evidence("second-run", "Track my shipment");
    const firstFinding = finding(firstEvidence.runId, "Previously analyzed capability", {
      inputTokens: 40,
      outputTokens: 10,
    });
    const captureSummaryPath = join(root, "capture-summary.json");
    await Promise.all([
      writeFile(join(firstRun, "evidence.json"), `${JSON.stringify(firstEvidence, null, 2)}\n`),
      writeFile(join(firstRun, "finding.json"), `${JSON.stringify(firstFinding, null, 2)}\n`),
      writeFile(join(secondRun, "evidence.json"), `${JSON.stringify(secondEvidence, null, 2)}\n`),
      writeFile(captureSummaryPath, `${JSON.stringify({
        schemaVersion: 2,
        mode: "capture-only",
        corpusRunId: "capture-source",
        startedAt: "2026-08-31T04:00:00.000Z",
        completedAt: "2026-08-31T04:20:00.000Z",
        selection: { all: true },
        cases: [
          capturedCase("CAPABILITY-001", "CAPABILITY", join(firstRun, "evidence.json")),
          capturedCase("TRACKING-001", "TRACKING", join(secondRun, "evidence.json")),
          {
            caseId: "AUTH-002",
            category: "AUTH",
            objective: "Observe authorized tracking",
            authenticated: true,
            dataPolicy: "authorized",
            executionMode: "automated",
            status: "preflight-required",
            reason: "Approved test value is missing.",
          },
        ],
      }, null, 2)}\n`),
    ]);

    const requests: Parameters<Analyzer["analyze"]>[0][] = [];
    const output: string[] = [];
    const dependencies = cliDependencies(output, {
      async analyze(request) {
        requests.push(request);
        return {
          model: "gpt-5.4-mini-2026-08-01",
          output: findingClaims(request.evidence.runId, "New tracking analysis"),
          usage: { inputTokens: 60, cachedInputTokens: 20, outputTokens: 15 },
        };
      },
    }, summaryOutputRoot);

    const exitCode = await runCli(["analyze-corpus", captureSummaryPath], dependencies);

    expect(exitCode).toBe(0);
    expect(requests.map(({ evidence }) => evidence.runId)).toEqual(["second-run"]);
    const analyzedSummaryPath = join(
      summaryOutputRoot,
      "2026-08-31_050000_analyzed",
      "summary.json",
    );
    const summary = JSON.parse(await readFile(analyzedSummaryPath, "utf8")) as {
      aggregateUsage: Record<string, number>;
      analysisPolicy: { model: string; reasoningEffort: string };
      cases: Array<Record<string, unknown>>;
      schemaVersion: number;
    };
    expect(summary).toMatchObject({
      schemaVersion: 1,
      analysisPolicy: { model: "gpt-5.4-mini", reasoningEffort: "none" },
      aggregateUsage: { inputTokens: 100, cachedInputTokens: 20, outputTokens: 25 },
    });
    expect(summary.cases).toMatchObject([
      { caseId: "CAPABILITY-001", status: "completed", findingPath: join(firstRun, "finding.json") },
      { caseId: "TRACKING-001", status: "completed", findingPath: join(secondRun, "finding.json") },
      { caseId: "AUTH-002", status: "skipped", reason: "Preflight required: Approved test value is missing." },
    ]);
    expect(output).toContain(`Analyzed corpus summary saved: ${analyzedSummaryPath}`);

    const reportPath = join(root, "report.md");
    expect(await runCli(["report", analyzedSummaryPath, "--output", reportPath], dependencies)).toBe(0);
    const report = await readFile(reportPath, "utf8");
    expect(report).toContain("Previously analyzed capability");
    expect(report).toContain("New tracking analysis");
    expect(report).toContain("AUTH-002");
  });

  test("records an invalid existing finding as a case failure without overwriting it", async () => {
    const root = await temporaryDirectories.create("maersk-invalid-corpus-finding-");
    const summaryOutputRoot = join(root, "corpus-runs");
    const runDirectory = join(root, "runs", "invalid");
    await Promise.all([
      mkdir(runDirectory, { recursive: true }),
      mkdir(summaryOutputRoot, { recursive: true }),
    ]);
    const evidencePath = join(runDirectory, "evidence.json");
    const findingPath = join(runDirectory, "finding.json");
    const captureSummaryPath = join(root, "capture-summary.json");
    await Promise.all([
      writeFile(evidencePath, `${JSON.stringify(evidence("invalid-run", "Track it"), null, 2)}\n`),
      writeFile(findingPath, "not-json\n"),
      writeFile(captureSummaryPath, `${JSON.stringify({
        schemaVersion: 2,
        mode: "capture-only",
        corpusRunId: "capture-source",
        startedAt: "2026-08-31T04:00:00.000Z",
        completedAt: "2026-08-31T04:20:00.000Z",
        selection: { caseId: "TRACKING-001" },
        cases: [capturedCase("TRACKING-001", "TRACKING", evidencePath)],
      }, null, 2)}\n`),
    ]);
    let analysisCalls = 0;
    const dependencies = cliDependencies([], {
      async analyze() {
        analysisCalls += 1;
        throw new Error("analysis must not overwrite an existing finding");
      },
    }, summaryOutputRoot);

    expect(await runCli(["analyze-corpus", captureSummaryPath], dependencies)).toBe(1);
    expect(analysisCalls).toBe(0);
    expect(await readFile(findingPath, "utf8")).toBe("not-json\n");
    const analyzedSummaryPath = join(
      summaryOutputRoot,
      "2026-08-31_050000_analyzed",
      "summary.json",
    );
    const summary = JSON.parse(await readFile(analyzedSummaryPath, "utf8")) as {
      cases: Array<{ error?: string; status: string }>;
    };
    expect(summary.cases[0]).toMatchObject({
      status: "failed",
      error: `Existing finding contains invalid JSON: ${findingPath}.`,
    });
  });
});

function evidence(runId: string, prompt: string): CaseEvidence {
  return {
    runId,
    startedAt: "2026-08-31T04:00:00.000Z",
    completedAt: "2026-08-31T04:00:02.000Z",
    conversation: [
      { index: 0, role: "user", text: prompt, timestamp: "2026-08-31T04:00:00.000Z" },
      { index: 1, role: "assistant", text: "Observed answer", timestamp: "2026-08-31T04:00:01.000Z" },
    ],
    screenshots: [],
    network: [],
    timings: [],
    page: { url: "https://example.test/", title: "Ask Maersk" },
    errors: [],
  };
}

function finding(runId: string, claim: string, usage: Record<string, number>): Finding {
  return {
    ...findingClaims(runId, claim),
    schemaVersion: 1,
    analysis: {
      model: "gpt-5.4-mini-2026-03-17",
      reasoningEffort: "none",
      usage,
    },
  } as Finding;
}

function findingClaims(runId: string, claim: string) {
  return {
    sourceRunId: runId,
    behavior: {
      classification: "direct-answer" as const,
      claim,
      evidenceReferences: [{ kind: "conversation" as const, locator: "1" }],
    },
    apiCandidates: [],
    askOneImplications: [{
      claim: "Reuse the observed behavior.",
      evidenceReferences: [{ kind: "conversation" as const, locator: "1" }],
    }],
  };
}

function capturedCase(caseId: string, category: string, evidencePath: string) {
  return {
    caseId,
    category,
    objective: `Observe ${caseId}`,
    authenticated: false,
    dataPolicy: "public",
    executionMode: "automated",
    status: "captured",
    evidencePath,
  };
}

function cliDependencies(
  output: string[],
  analyzer: Analyzer,
  summaryOutputRoot: string,
): Parameters<typeof runCli>[1] {
  const browser: BrowserRecorder = {
    async capture() {
      throw new Error("browser should not launch during corpus analysis");
    },
  };
  return {
    browser,
    createAnalyzer: () => analyzer,
    createCorpusRunId: () => "analyzed",
    createRunId: () => "unused",
    environment: {
      OPEN_AI_API_KEY: "test-api-key",
      RESEARCH_CORPUS_OUTPUT_DIR: summaryOutputRoot,
    },
    now: () => new Date("2026-08-31T05:00:00.000Z"),
    stdout: (message) => output.push(message),
    waitForCompletion: async () => undefined,
  };
}
