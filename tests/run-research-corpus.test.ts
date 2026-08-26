import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { AnalysisUsage } from "../src/analysis/analyze-evidence.ts";
import { runResearchCorpus } from "../src/corpus/run-research-corpus.ts";
import type { ResearchCase } from "../src/domain/research-case.ts";
import { sequenceClock } from "./support/sequence-clock.ts";
import { createTemporaryDirectoryTracker } from "./support/temp-directories.ts";

const temporaryDirectories = createTemporaryDirectoryTracker();

afterEach(() => temporaryDirectories.cleanup());

describe("runResearchCorpus", () => {
  test("runs one category in declared order and aggregates completed, failed, and skipped cases", async () => {
    const outputRoot = await temporaryDirectories.create("maersk-corpus-");
    const executed: string[] = [];

    const result = await runResearchCorpus(
      {
        analysisPolicy: { model: "gpt-5.4-mini", reasoningEffort: "none" },
        cases: [
          researchCase("TRACK-002", "TRACKING"),
          researchCase("CAPABILITY-001", "CAPABILITY"),
          researchCase("TRACK-001", "TRACKING"),
          researchCase("TRACK-003", "TRACKING"),
        ],
        outputRoot,
        selection: { category: "TRACKING" },
      },
      {
        createCorpusRunId: () => "category-run",
        executeCase: async (case_) => {
          executed.push(case_.id);
          if (case_.id === "TRACK-001") throw new Error("capture timed out");
          if (case_.id === "TRACK-003") {
            return { status: "skipped", reason: "requires authorized test data" };
          }
          return completed(case_.id, {
            inputTokens: 100,
            cachedInputTokens: 25,
            outputTokens: 20,
            reasoningTokens: 5,
          });
        },
        now: sequenceClock(
          "2026-08-26T06:00:00.000Z",
          "2026-08-26T06:00:03.000Z",
        ),
      },
    );

    expect(executed).toEqual(["TRACK-002", "TRACK-001", "TRACK-003"]);
    expect(result.summary.cases.map(({ caseId, status }) => [caseId, status])).toEqual([
      ["TRACK-002", "completed"],
      ["TRACK-001", "failed"],
      ["TRACK-003", "skipped"],
    ]);
    expect(result.summary.aggregateUsage).toEqual({
      inputTokens: 100,
      cachedInputTokens: 25,
      outputTokens: 20,
      reasoningTokens: 5,
    });
    expect(result.summary.cases[0]).toMatchObject({
      evidencePath: "runs/TRACK-002/evidence.json",
      findingPath: "runs/TRACK-002/finding.json",
    });
    expect(result.summary.cases[1]).toMatchObject({ error: "capture timed out" });
    expect(result.summary.cases[2]).toMatchObject({
      reason: "requires authorized test data",
    });
    expect(result.summaryPath).toBe(join(result.runDirectory, "summary.json"));
    await expect(writeFile(result.summaryPath, "replace", { flag: "wx" })).rejects.toMatchObject({
      code: "EEXIST",
    });
  });

  test("selects one case and rejects unknown or ambiguous selections", async () => {
    const outputRoot = await temporaryDirectories.create("maersk-corpus-");
    const cases = [researchCase("AUTH-001", "AUTH"), researchCase("AUTH-002", "AUTH")];
    const executed: string[] = [];

    const result = await runResearchCorpus(
      {
        analysisPolicy: { model: "gpt-5.4-mini", reasoningEffort: "none" },
        cases,
        outputRoot,
        selection: { caseId: "AUTH-002" },
      },
      dependencies("single", async (case_) => {
        executed.push(case_.id);
        return completed(case_.id);
      }),
    );

    expect(executed).toEqual(["AUTH-002"]);
    expect(result.summary.selection).toEqual({ caseId: "AUTH-002" });
    await expect(
      runResearchCorpus(
        {
          analysisPolicy: { model: "gpt-5.4-mini", reasoningEffort: "none" },
          cases,
          outputRoot,
          selection: { caseId: "MISSING" },
        },
        dependencies("missing", async () => completed("unused")),
      ),
    ).rejects.toThrow('Research case "MISSING" was not found.');
  });

  test("resumes into a new immutable summary without rerunning completed cases", async () => {
    const outputRoot = await temporaryDirectories.create("maersk-corpus-");
    const cases = [researchCase("KNOWLEDGE-001", "KNOWLEDGE"), researchCase("KNOWLEDGE-002", "KNOWLEDGE")];
    const first = await runResearchCorpus(
      {
        analysisPolicy: { model: "gpt-5.4-mini", reasoningEffort: "none" },
        cases,
        outputRoot,
        selection: { category: "KNOWLEDGE" },
      },
      dependencies("first", async (case_) => {
        if (case_.id === "KNOWLEDGE-002") throw new Error("temporary failure");
        return completed(case_.id, { inputTokens: 40, outputTokens: 10 });
      }),
    );
    const firstSummaryBeforeResume = await readFile(first.summaryPath, "utf8");
    const resumedCases: string[] = [];

    const resumed = await runResearchCorpus(
      {
        analysisPolicy: { model: "gpt-5.4-mini", reasoningEffort: "none" },
        cases,
        outputRoot,
        resumeFrom: first.summary,
        resumeFromPath: first.summaryPath,
        selection: { category: "KNOWLEDGE" },
      },
      dependencies("resumed", async (case_) => {
        resumedCases.push(case_.id);
        return completed(case_.id, { inputTokens: 60, outputTokens: 15 });
      }),
    );

    expect(resumedCases).toEqual(["KNOWLEDGE-002"]);
    expect(
      resumed.summary.cases.map((result) => ({
        caseId: result.caseId,
        status: result.status,
        resumed: "resumed" in result ? result.resumed : undefined,
      })),
    ).toEqual([
      { caseId: "KNOWLEDGE-001", status: "completed", resumed: true },
      { caseId: "KNOWLEDGE-002", status: "completed", resumed: undefined },
    ]);
    expect(resumed.summary.aggregateUsage).toEqual({ inputTokens: 100, outputTokens: 25 });
    expect(resumed.summary.resumedFrom).toBe(first.summaryPath);
    expect(await readFile(first.summaryPath, "utf8")).toBe(firstSummaryBeforeResume);
  });
});

function researchCase(id: string, category: ResearchCase["category"]): ResearchCase {
  return {
    id,
    category,
    objective: `Research ${id}`,
    authenticated: false,
    dataPolicy: "public",
    executionMode: "automated",
    messages: [{ text: `Prompt for ${id}` }],
    captureTrace: false,
  };
}

function completed(caseId: string, usage?: AnalysisUsage) {
  return {
    status: "completed" as const,
    evidencePath: `runs/${caseId}/evidence.json`,
    findingPath: `runs/${caseId}/finding.json`,
    ...(typeof usage === "undefined" ? {} : { usage }),
  };
}

function dependencies(
  runId: string,
  executeCase: Parameters<typeof runResearchCorpus>[1]["executeCase"],
): Parameters<typeof runResearchCorpus>[1] {
  return {
    createCorpusRunId: () => runId,
    executeCase,
    now: sequenceClock("2026-08-26T06:00:00.000Z", "2026-08-26T06:00:01.000Z"),
  };
}
