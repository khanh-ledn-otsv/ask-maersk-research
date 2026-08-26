import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { CaseEvidence } from "../src/domain/evidence.ts";
import { runCli } from "../src/cli/run-cli.ts";
import type { BrowserRecorder } from "../src/recording/record-research-session.ts";
import { createTemporaryDirectoryTracker } from "./support/temp-directories.ts";

const temporaryDirectories = createTemporaryDirectoryTracker();

afterEach(() => temporaryDirectories.cleanup());

describe("research report CLI", () => {
  test("generates the manager-ready sections and primary evidence matrix", async () => {
    const fixture = await writeCorpusFixture();
    const reportPath = join(fixture.root, "reports", "maersk-research.md");
    const output: string[] = [];

    const exitCode = await runCli(
      ["report", fixture.summaryPath, "--output", reportPath],
      cliDependencies(output),
    );

    expect(exitCode).toBe(0);
    expect(output).toEqual([`Research report saved: ${reportPath}`]);
    const report = await readFile(reportPath, "utf8");
    expect(report).toContain("# Ask Maersk Research Report");
    expect(report).toContain("## Capability Map");
    expect(report).toContain("## Representative User Journeys");
    expect(report).toContain("## Primary Evidence Matrix");
    expect(report).toContain(
      "| Case | Observation | Evidence | Architecture inference | Ask ONE implication |",
    );
    expect(report).toContain("## Observed Architecture Patterns");
    expect(report).toContain("## Strengths and Weaknesses");
    expect(report).toContain("## Ask ONE Implications");
    expect(report).toContain("## Analysis Cost");
    expect(report).toContain("TRACKING");
    expect(report).toContain("Ask Maersk requests a shipment identifier.");
    expect(report).toContain("Clarification before a tracking tool call.");
    expect(report).toContain("Collect the identifier before tracking.");
    expect(report).toContain("**User:** Track my shipment");
    expect(report).toContain("**Ask Maersk:** Please provide a shipment identifier.");
    expect(report).toContain("`gpt-5.4-mini-2026-03-17` (1 case)");
    expect(report).toContain("### Screenshots");
    expect(report).toContain("TRACK-001: Ask Maersk requests a shipment identifier.");
    const strengths = report.slice(
      report.indexOf("### Strengths"),
      report.indexOf("### Weaknesses"),
    );
    expect(strengths).not.toContain("Ask Maersk requests a shipment identifier.");
    expect(report).toContain("### Context-dependent Patterns");
  });

  test("escapes captured Markdown and table delimiters", async () => {
    const fixture = await writeCorpusFixture({
      observation: "Supports | schedules\nand <script>tracking</script>.",
    });
    const reportPath = join(fixture.root, "reports", "escaped.md");

    expect(
      await runCli(
        ["report", fixture.summaryPath, "--output", reportPath],
        cliDependencies([]),
      ),
    ).toBe(0);

    const report = await readFile(reportPath, "utf8");
    expect(report).toContain(
      "Supports \\| schedules<br>and \\<script\\>tracking\\</script\\>.",
    );
    expect(report).not.toContain("<script>tracking</script>");
  });

  test("omits factual findings when a completed case has missing evidence", async () => {
    const fixture = await writeCorpusFixture({ missingEvidence: true });
    const reportPath = join(fixture.root, "reports", "missing-evidence.md");

    expect(
      await runCli(
        ["report", fixture.summaryPath, "--output", reportPath],
        cliDependencies([]),
      ),
    ).toBe(0);

    const report = await readFile(reportPath, "utf8");
    expect(report).toContain("Coverage: 0 evidence-backed cases of 1");
    expect(report).toContain("TRACK-001");
    expect(report).toContain("evidence unavailable");
    expect(report).not.toContain("Ask Maersk requests a shipment identifier.");
  });

  test("keeps completed findings useful while exposing partial-run gaps", async () => {
    const fixture = await writeCorpusFixture();
    const summary = JSON.parse(await readFile(fixture.summaryPath, "utf8")) as {
      cases: Record<string, unknown>[];
    };
    summary.cases.push(
      {
        caseId: "TRACK-002",
        category: "TRACKING",
        objective: "Observe a tracked shipment",
        authenticated: true,
        dataPolicy: "authorized",
        executionMode: "manual",
        status: "failed",
        error: "capture timed out",
      },
      {
        caseId: "TRACK-003",
        category: "TRACKING",
        objective: "Observe tracking guardrails",
        authenticated: false,
        dataPolicy: "fake",
        executionMode: "automated",
        status: "skipped",
        reason: "selector unavailable",
      },
    );
    await writeFile(fixture.summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    const reportPath = join(fixture.root, "reports", "partial.md");

    expect(
      await runCli(
        ["report", fixture.summaryPath, "--output", reportPath],
        cliDependencies([]),
      ),
    ).toBe(0);

    const report = await readFile(reportPath, "utf8");
    expect(report).toContain("Coverage: 1 evidence-backed case of 3");
    expect(report).toContain("Ask Maersk requests a shipment identifier.");
    expect(report).toContain("**TRACK-002:** failed: capture timed out");
    expect(report).toContain("**TRACK-003:** skipped: selector unavailable");
  });

  test("keeps the decisive final turns of a long representative journey", async () => {
    const fixture = await writeCorpusFixture();
    const evidence = JSON.parse(await readFile(fixture.evidencePath, "utf8")) as {
      conversation: Record<string, unknown>[];
    };
    evidence.conversation = [
      ...evidence.conversation,
      { index: 2, role: "user", text: "Use ABC123", timestamp: "2026-08-26T08:00:02.000Z" },
      { index: 3, role: "assistant", text: "Which carrier?", timestamp: "2026-08-26T08:00:03.000Z" },
      { index: 4, role: "user", text: "Maersk", timestamp: "2026-08-26T08:00:04.000Z" },
      { index: 5, role: "assistant", text: "Your shipment arrives Friday.", timestamp: "2026-08-26T08:00:05.000Z" },
    ];
    await writeFile(fixture.evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    const reportPath = join(fixture.root, "reports", "long-journey.md");

    expect(
      await runCli(
        ["report", fixture.summaryPath, "--output", reportPath],
        cliDependencies([]),
      ),
    ).toBe(0);

    const report = await readFile(reportPath, "utf8");
    expect(report).toContain("Your shipment arrives Friday.");
    expect(report).toContain("2 intermediate turns omitted");
  });

  test("highlights enough useful screenshots and network examples when available", async () => {
    const fixture = await writeCorpusFixture();
    const evidence = JSON.parse(await readFile(fixture.evidencePath, "utf8")) as {
      screenshots: { path: string; kind: string }[];
      network: Record<string, unknown>[];
    };
    const screenshotDirectory = join(fixture.root, "runs", "TRACK-001", "screenshots");
    for (let index = 3; index <= 9; index += 1) {
      const filename = `${String(index).padStart(2, "0")}-result.png`;
      evidence.screenshots.push({ path: `screenshots/${filename}`, kind: "result" });
      await writeFile(join(screenshotDirectory, filename), "screenshot");
    }
    evidence.network.push(
      {
        id: "request-2",
        timestamp: "2026-08-26T08:00:00.200Z",
        method: "GET",
        url: "https://example.test/api/schedules",
        resourceType: "fetch",
        status: 200,
      },
      {
        id: "request-3",
        timestamp: "2026-08-26T08:00:00.300Z",
        method: "POST",
        url: "https://example.test/api/chat",
        resourceType: "fetch",
        status: 200,
      },
    );
    await writeFile(fixture.evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    const reportPath = join(fixture.root, "reports", "highlights.md");

    expect(
      await runCli(
        ["report", fixture.summaryPath, "--output", reportPath],
        cliDependencies([]),
      ),
    ).toBe(0);

    const report = await readFile(reportPath, "utf8");
    const highlights = report.slice(
      report.indexOf("## Evidence Highlights"),
      report.indexOf("## Analysis Cost"),
    );
    expect(highlights.match(/^- \[TRACK-001:/gmu)).toHaveLength(8);
    expect(highlights).toContain("https://example.test/api/schedules");
    expect(highlights).toContain("https://example.test/api/chat");
  });
});

async function writeCorpusFixture(
  options: { readonly missingEvidence?: boolean; readonly observation?: string } = {},
): Promise<{ evidencePath: string; root: string; summaryPath: string }> {
  const root = await temporaryDirectories.create("maersk-report-");
  const caseDirectory = join(root, "runs", "TRACK-001");
  const summaryDirectory = join(root, "corpus");
  await mkdir(caseDirectory, { recursive: true });
  await mkdir(join(caseDirectory, "screenshots"));
  await mkdir(summaryDirectory, { recursive: true });
  const evidencePath = join(caseDirectory, "evidence.json");
  const findingPath = join(caseDirectory, "finding.json");
  const summaryPath = join(summaryDirectory, "summary.json");
  const evidence = {
    runId: "tracking-run",
    caseId: "TRACK-001",
    startedAt: "2026-08-26T08:00:00.000Z",
    completedAt: "2026-08-26T08:00:02.000Z",
    conversation: [
      {
        index: 0,
        role: "user",
        text: "Track my shipment",
        timestamp: "2026-08-26T08:00:00.000Z",
      },
      {
        index: 1,
        role: "assistant",
        text: "Please provide a shipment identifier.",
        timestamp: "2026-08-26T08:00:01.000Z",
        screenshot: "screenshots/02-result.png",
      },
    ],
    screenshots: [{ path: "screenshots/02-result.png", kind: "result" }],
    network: [
      {
        id: "request-1",
        timestamp: "2026-08-26T08:00:00.100Z",
        method: "POST",
        url: "https://example.test/api/tracking",
        resourceType: "fetch",
        status: 200,
      },
    ],
    timings: [{ turnIndex: 0, submittedAt: "2026-08-26T08:00:00.000Z" }],
    page: { url: "https://example.test/ask-maersk", title: "Ask Maersk" },
    errors: [],
  } satisfies CaseEvidence;
  const finding = {
    schemaVersion: 1,
    sourceRunId: evidence.runId,
    behavior: {
      classification: "clarification",
      claim: options.observation ?? "Ask Maersk requests a shipment identifier.",
      evidenceReferences: [
        { kind: "conversation", locator: "1" },
        { kind: "screenshot", locator: "screenshots/02-result.png" },
      ],
    },
    apiCandidates: [
      {
        name: "Tracking orchestration",
        rationale: "Clarification before a tracking tool call.",
        confidence: "medium",
        evidenceReferences: [{ kind: "network", locator: "request-1" }],
      },
    ],
    askOneImplications: [
      {
        claim: "Collect the identifier before tracking.",
        evidenceReferences: [{ kind: "conversation", locator: "1" }],
      },
    ],
    analysis: {
      model: "gpt-5.4-mini-2026-03-17",
      reasoningEffort: "none",
      usage: { inputTokens: 100, cachedInputTokens: 20, outputTokens: 30 },
    },
  };
  const summary = {
    schemaVersion: 1,
    corpusRunId: "tracking-corpus",
    startedAt: "2026-08-26T08:00:00.000Z",
    completedAt: "2026-08-26T08:00:03.000Z",
    selection: { category: "TRACKING" },
    analysisPolicy: { model: "gpt-5.4-mini", reasoningEffort: "none" },
    aggregateUsage: { inputTokens: 100, cachedInputTokens: 20, outputTokens: 30 },
    cases: [
      {
        caseId: "TRACK-001",
        category: "TRACKING",
        objective: "Observe tracking clarification",
        authenticated: false,
        dataPolicy: "public",
        executionMode: "automated",
        status: "completed",
        evidencePath,
        findingPath,
        usage: { inputTokens: 100, cachedInputTokens: 20, outputTokens: 30 },
      },
    ],
  };
  await Promise.all([
    ...(options.missingEvidence === true
      ? []
      : [writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`)]),
    writeFile(findingPath, `${JSON.stringify(finding, null, 2)}\n`),
    writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`),
    writeFile(join(caseDirectory, "screenshots", "02-result.png"), "screenshot"),
  ]);
  return { evidencePath, root, summaryPath };
}

function cliDependencies(output: string[]): Parameters<typeof runCli>[1] {
  const browser: BrowserRecorder = {
    async capture() {
      throw new Error("browser should not launch");
    },
  };
  return {
    browser,
    createRunId: () => "unused",
    environment: {},
    now: () => new Date("2026-08-26T08:00:00.000Z"),
    stdout: (message) => output.push(message),
    waitForCompletion: async () => undefined,
  };
}
