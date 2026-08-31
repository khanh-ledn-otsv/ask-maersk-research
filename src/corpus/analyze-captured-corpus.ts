import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  analyzeEvidence,
  findingClaimsSchema,
  validateFindingClaims,
  type AnalysisUsage,
  type Analyzer,
  type Finding,
} from "../analysis/analyze-evidence.ts";
import type { CaseEvidence } from "../domain/evidence.ts";
import type {
  AnalyzedCorpusSummary,
  CaptureCorpusSummary,
  CorpusAnalysisPolicy,
  CorpusCaseDescriptor,
  CorpusCaseOutcome,
  CorpusCaseResult,
} from "./run-research-corpus.ts";

export interface AnalyzeCapturedCorpusInput {
  readonly analysisPolicy: CorpusAnalysisPolicy;
  readonly captureSummaryPath: string;
  readonly outputRoot: string;
}

export interface AnalyzeCapturedCorpusDependencies {
  readonly analyzer: Analyzer;
  readonly createCorpusRunId: () => string;
  readonly now: () => Date;
  readonly onCaseStart?: (caseId: string, evidencePath: string) => void;
}

export interface AnalyzedCapturedCorpusRun {
  readonly summary: AnalyzedCorpusSummary;
  readonly summaryPath: string;
}

export async function analyzeCapturedCorpus(
  input: AnalyzeCapturedCorpusInput,
  dependencies: AnalyzeCapturedCorpusDependencies,
): Promise<AnalyzedCapturedCorpusRun> {
  const captureSummaryPath = resolve(input.captureSummaryPath);
  const captureSummary = JSON.parse(await readFile(captureSummaryPath, "utf8")) as unknown;
  assertCaptureCorpusSummary(captureSummary, captureSummaryPath);
  const startedAt = dependencies.now().toISOString();
  const results: CorpusCaseResult[] = [];

  for (const result of captureSummary.cases) {
    const descriptor = caseDescriptor(result);
    if (result.status === "captured") {
      const evidencePath = await resolveEvidencePath(result.evidencePath, captureSummaryPath);
      dependencies.onCaseStart?.(result.caseId, evidencePath);
      try {
        results.push({
          ...descriptor,
          ...(await analyzeCapturedCase(
            evidencePath,
            input.analysisPolicy,
            dependencies.analyzer,
          )),
        });
      } catch (error: unknown) {
        results.push({
          ...descriptor,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
          evidencePath,
        });
      }
      continue;
    }
    if (result.status === "preflight-required") {
      results.push({
        ...descriptor,
        status: "skipped",
        reason: `Preflight required: ${result.reason}`,
      });
      continue;
    }
    if (result.status === "capture-failed") {
      results.push({
        ...descriptor,
        status: "failed",
        error: `Capture failed: ${result.error}`,
        ...(typeof result.evidencePath === "undefined"
          ? {}
          : { evidencePath: await resolveEvidencePath(result.evidencePath, captureSummaryPath) }),
      });
      continue;
    }
    if (result.status === "skipped") {
      results.push({ ...descriptor, status: "skipped", reason: result.reason });
      continue;
    }
    throw new Error(`Invalid capture-only case status for ${result.caseId}: ${result.status}.`);
  }

  const corpusRunId = `${formatRunTimestamp(startedAt)}_${dependencies.createCorpusRunId()}`;
  const runDirectory = join(resolve(input.outputRoot), corpusRunId);
  const summaryPath = join(runDirectory, "summary.json");
  const summary: AnalyzedCorpusSummary = {
    schemaVersion: 1,
    corpusRunId,
    startedAt,
    completedAt: dependencies.now().toISOString(),
    selection: captureSummary.selection,
    analysisPolicy: input.analysisPolicy,
    aggregateUsage: aggregateUsage(results),
    cases: results,
    resumedFrom: captureSummaryPath,
  };
  await mkdir(resolve(input.outputRoot), { recursive: true });
  await mkdir(runDirectory);
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, { flag: "wx" });
  return { summary, summaryPath };
}

async function analyzeCapturedCase(
  evidencePath: string,
  policy: CorpusAnalysisPolicy,
  analyzer: Analyzer,
): Promise<Extract<CorpusCaseOutcome, { status: "completed" }>> {
  const evidence = JSON.parse(await readFile(evidencePath, "utf8")) as CaseEvidence;
  const findingPath = join(dirname(evidencePath), "finding.json");
  const existing = await readExistingFinding(findingPath);
  const finding = typeof existing === "undefined"
    ? await analyzeEvidence(evidence, { analyzer, ...policy })
    : validateReusableFinding(existing, evidence, policy, findingPath);
  if (typeof existing === "undefined") {
    await writeFile(findingPath, `${JSON.stringify(finding, null, 2)}\n`, { flag: "wx" });
  }
  return {
    status: "completed",
    evidencePath,
    findingPath,
    ...(typeof finding.analysis.usage === "undefined"
      ? {}
      : { usage: finding.analysis.usage }),
  };
}

async function readExistingFinding(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error: unknown) {
    if (isFileSystemError(error, "ENOENT")) return undefined;
    if (error instanceof SyntaxError) {
      throw new Error(`Existing finding contains invalid JSON: ${path}.`);
    }
    throw error;
  }
}

function validateReusableFinding(
  value: unknown,
  evidence: CaseEvidence,
  policy: CorpusAnalysisPolicy,
  path: string,
): Finding {
  if (typeof value !== "object" || value === null) {
    throw new Error(`Existing finding is invalid: ${path}.`);
  }
  const candidate = value as Partial<Finding>;
  const claims = findingClaimsSchema.safeParse({
    sourceRunId: candidate.sourceRunId,
    behavior: candidate.behavior,
    apiCandidates: candidate.apiCandidates,
    askOneImplications: candidate.askOneImplications,
  });
  if (!claims.success || candidate.schemaVersion !== 1 ||
    typeof candidate.analysis?.model !== "string" ||
    typeof candidate.analysis.reasoningEffort !== "string" ||
    !isAnalysisUsage(candidate.analysis.usage)) {
    throw new Error(`Existing finding is invalid: ${path}.`);
  }
  validateFindingClaims(claims.data, evidence);
  const modelMatches = candidate.analysis.model === policy.model ||
    candidate.analysis.model.startsWith(`${policy.model}-`);
  if (!modelMatches || candidate.analysis.reasoningEffort !== policy.reasoningEffort) {
    throw new Error(
      `Existing finding analysis policy does not match model=${policy.model} reasoning=${policy.reasoningEffort}: ${path}.`,
    );
  }
  return candidate as Finding;
}

function isAnalysisUsage(value: unknown): value is AnalysisUsage | undefined {
  if (typeof value === "undefined") return true;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const usage = value as Record<string, unknown>;
  return ["inputTokens", "cachedInputTokens", "outputTokens", "reasoningTokens"].every((key) =>
    typeof usage[key] === "undefined" ||
    (typeof usage[key] === "number" && Number.isFinite(usage[key]) && usage[key] >= 0)
  );
}

async function resolveEvidencePath(path: string, summaryPath: string): Promise<string> {
  if (isAbsolute(path)) return path;
  const candidates = [resolve(path), resolve(dirname(summaryPath), path)];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next interpretation of this legacy relative artifact path.
    }
  }
  return candidates[0] as string;
}

function caseDescriptor(result: CorpusCaseResult): CorpusCaseDescriptor {
  return {
    caseId: result.caseId,
    category: result.category,
    objective: result.objective,
    authenticated: result.authenticated,
    dataPolicy: result.dataPolicy,
    executionMode: result.executionMode,
    ...(typeof result.notes === "undefined" ? {} : { notes: result.notes }),
  };
}

function aggregateUsage(results: readonly CorpusCaseResult[]): AnalysisUsage {
  const usage = results.flatMap((result) =>
    result.status === "completed" && typeof result.usage !== "undefined"
      ? [result.usage]
      : [],
  );
  return Object.fromEntries(
    (["inputTokens", "cachedInputTokens", "outputTokens", "reasoningTokens"] as const)
      .flatMap((key) => {
        const values = usage.flatMap((entry) =>
          typeof entry[key] === "undefined" ? [] : [entry[key]],
        );
        return values.length === 0
          ? []
          : [[key, values.reduce((sum, value) => sum + value, 0)] as const];
      }),
  );
}

function assertCaptureCorpusSummary(
  value: unknown,
  path: string,
): asserts value is CaptureCorpusSummary {
  if (typeof value !== "object" || value === null ||
    !("schemaVersion" in value) || value.schemaVersion !== 2 ||
    !("mode" in value) || value.mode !== "capture-only" ||
    !("selection" in value) ||
    !("cases" in value) || !Array.isArray(value.cases) ||
    value.cases.some((case_) =>
      typeof case_ !== "object" || case_ === null || !("status" in case_) ||
      !["captured", "capture-failed", "preflight-required", "skipped"].includes(String(case_.status))
    )) {
    throw new Error(`Invalid capture-only corpus summary: ${path}.`);
  }
}

function isFileSystemError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

function formatRunTimestamp(isoTimestamp: string): string {
  return isoTimestamp.slice(0, 19).replace("T", "_").replaceAll(":", "");
}
