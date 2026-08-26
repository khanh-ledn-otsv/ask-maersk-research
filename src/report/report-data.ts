import { access, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { EvidenceReference, Finding } from "../analysis/analyze-evidence.ts";
import type { CorpusCaseResult, CorpusSummary } from "../corpus/run-research-corpus.ts";
import type { CaseEvidence } from "../domain/evidence.ts";

export type ReferenceKey = string & { readonly referenceKey: unique symbol };

export interface LoadedCase {
  readonly result: Extract<CorpusCaseResult, { status: "completed" }>;
  readonly availableScreenshotPaths: ReadonlySet<string>;
  readonly evidence: CaseEvidence;
  readonly evidencePath: string;
  readonly finding: Finding;
  readonly supportedReferences: ReadonlySet<ReferenceKey>;
}

export interface UnavailableCase {
  readonly caseId: string;
  readonly reason: string;
}

export interface ReportData {
  readonly available: readonly LoadedCase[];
  readonly unavailable: readonly UnavailableCase[];
}

export interface LoadedReportData {
  readonly data: ReportData;
  readonly summary: CorpusSummary;
}

export async function loadReportData(summaryPath: string): Promise<LoadedReportData> {
  const summary = await readJson<CorpusSummary>(summaryPath);
  assertCorpusSummary(summary, summaryPath);
  const available: LoadedCase[] = [];
  const unavailable: UnavailableCase[] = summary.cases.flatMap((result) =>
    result.status === "failed"
      ? [{ caseId: result.caseId, reason: `failed: ${result.error}` }]
      : result.status === "skipped"
        ? [{ caseId: result.caseId, reason: `skipped: ${result.reason}` }]
        : [],
  );

  for (const result of summary.cases) {
    if (result.status !== "completed") continue;
    const evidencePath = resolveArtifactPath(result.evidencePath, summaryPath);
    const findingPath = resolveArtifactPath(result.findingPath, summaryPath);
    try {
      const [evidence, finding] = await Promise.all([
        readJson<CaseEvidence>(evidencePath),
        readJson<Finding>(findingPath),
      ]);
      assertEvidence(evidence);
      assertFinding(finding);
      available.push({
        result,
        evidence,
        evidencePath,
        finding,
        availableScreenshotPaths: await collectAvailableScreenshotPaths(
          evidence,
          evidencePath,
        ),
        supportedReferences: collectSupportedReferences(evidence),
      });
    } catch (error: unknown) {
      unavailable.push({
        caseId: result.caseId,
        reason: `evidence unavailable: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  return { data: { available, unavailable }, summary };
}

export function referenceKey(reference: EvidenceReference): ReferenceKey {
  return `${reference.kind}:${reference.locator}` as ReferenceKey;
}

function collectSupportedReferences(evidence: CaseEvidence): ReadonlySet<ReferenceKey> {
  const references: EvidenceReference[] = [
    { kind: "page", locator: "page" },
    ...evidence.conversation.map(({ index }) => ({
      kind: "conversation" as const,
      locator: String(index),
    })),
    ...evidence.screenshots.map(({ path }) => ({ kind: "screenshot" as const, locator: path })),
    ...evidence.network.map(({ id }) => ({ kind: "network" as const, locator: id })),
    ...evidence.timings.map(({ turnIndex }) => ({
      kind: "timing" as const,
      locator: String(turnIndex),
    })),
    ...evidence.errors.map((_, index) => ({ kind: "error" as const, locator: String(index) })),
  ];
  return new Set(references.map(referenceKey));
}

async function collectAvailableScreenshotPaths(
  evidence: CaseEvidence,
  evidencePath: string,
): Promise<ReadonlySet<string>> {
  const availability = await Promise.all(
    evidence.screenshots.map(async ({ path }) => ({
      path,
      available: await fileExists(join(dirname(evidencePath), path)),
    })),
  );
  return new Set(availability.filter(({ available }) => available).map(({ path }) => path));
}

function resolveArtifactPath(path: string, summaryPath: string): string {
  return isAbsolute(path) ? path : resolve(dirname(summaryPath), path);
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function assertCorpusSummary(value: CorpusSummary, path: string): void {
  if (value.schemaVersion !== 1 || !Array.isArray(value.cases)) {
    throw new Error(`Invalid corpus summary: ${path}.`);
  }
}

function assertEvidence(value: CaseEvidence): void {
  if (
    typeof value.runId !== "string" ||
    !Array.isArray(value.conversation) ||
    !Array.isArray(value.screenshots) ||
    !Array.isArray(value.network) ||
    !Array.isArray(value.timings) ||
    !Array.isArray(value.errors)
  ) {
    throw new Error("invalid evidence file");
  }
}

function assertFinding(value: Finding): void {
  if (
    value.schemaVersion !== 1 ||
    typeof value.behavior?.claim !== "string" ||
    !Array.isArray(value.behavior.evidenceReferences) ||
    !Array.isArray(value.apiCandidates) ||
    !Array.isArray(value.askOneImplications)
  ) {
    throw new Error("invalid finding file");
  }
}
