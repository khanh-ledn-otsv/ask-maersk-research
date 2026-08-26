import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  analyzeEvidence,
  type Analyzer,
} from "../analysis/analyze-evidence.ts";
import type { ResearchCase } from "../domain/research-case.ts";
import {
  recordResearchSession,
  type BrowserInteraction,
  type BrowserRecorder,
} from "../recording/record-research-session.ts";
import type {
  CorpusAnalysisPolicy,
  CorpusCaseExecution,
} from "./run-research-corpus.ts";

export interface ExecuteCorpusCaseOptions {
  readonly interaction: BrowserInteraction;
  readonly outputRoot: string;
  readonly targetUrl: string;
  readonly waitForCompletion: () => Promise<void>;
}

export interface ExecuteCorpusCaseDependencies {
  readonly analyzer: Analyzer;
  readonly browser: BrowserRecorder;
  readonly createRunId: () => string;
  readonly now: () => Date;
}

export async function executeCorpusCase(
  case_: ResearchCase,
  analysisPolicy: CorpusAnalysisPolicy,
  options: ExecuteCorpusCaseOptions,
  dependencies: ExecuteCorpusCaseDependencies,
): Promise<CorpusCaseExecution> {
  const recorded = await recordResearchSession(
    {
      captureTrace: case_.captureTrace,
      caseId: case_.id,
      interaction: options.interaction,
      outputRoot: options.outputRoot,
      targetUrl: options.targetUrl,
      userMessages: case_.messages.map(({ text }) => text),
      waitForCompletion: options.waitForCompletion,
    },
    dependencies,
  );
  const evidencePath = join(recorded.runDirectory, "evidence.json");

  try {
    const evidence = JSON.parse(await readFile(evidencePath, "utf8")) as Parameters<
      typeof analyzeEvidence
    >[0];
    const finding = await analyzeEvidence(evidence, {
      analyzer: dependencies.analyzer,
      model: analysisPolicy.model,
      reasoningEffort: analysisPolicy.reasoningEffort,
    });
    const findingPath = join(recorded.runDirectory, "finding.json");
    await writeFile(findingPath, `${JSON.stringify(finding, null, 2)}\n`, { flag: "wx" });
    return {
      status: "completed",
      evidencePath,
      findingPath,
      ...(typeof finding.analysis.usage === "undefined"
        ? {}
        : { usage: finding.analysis.usage }),
    };
  } catch (error: unknown) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
      evidencePath,
    };
  }
}
