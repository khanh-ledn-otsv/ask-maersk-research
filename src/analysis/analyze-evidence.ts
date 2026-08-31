import { z } from "zod";
import type { CaseEvidence } from "../domain/evidence.ts";

export const DEFAULT_ANALYSIS_MODEL = "gpt-5.4-mini";
export const DEFAULT_REASONING_EFFORT = "none";

export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh";
export type EvidenceReferenceKind =
  | "conversation"
  | "error"
  | "network"
  | "page"
  | "screenshot"
  | "timing";

export interface EvidenceReference {
  readonly kind: EvidenceReferenceKind;
  readonly locator: string;
}

export interface BehaviorFinding {
  readonly classification:
    | "direct-answer"
    | "clarification"
    | "guided-action"
    | "handoff"
    | "refusal"
    | "failure"
    | "unknown";
  readonly claim: string;
  readonly evidenceReferences: readonly EvidenceReference[];
}

export interface ApiCandidateFinding {
  readonly name: string;
  readonly rationale: string;
  readonly confidence: "low" | "medium" | "high";
  readonly evidenceReferences: readonly EvidenceReference[];
}

export interface AskOneImplicationFinding {
  readonly claim: string;
  readonly evidenceReferences: readonly EvidenceReference[];
}

export interface FindingClaims {
  readonly sourceRunId: string;
  readonly behavior: BehaviorFinding;
  readonly apiCandidates: readonly ApiCandidateFinding[];
  readonly askOneImplications: readonly AskOneImplicationFinding[];
}

export interface AnalysisUsage {
  readonly inputTokens?: number;
  readonly cachedInputTokens?: number;
  readonly outputTokens?: number;
  readonly reasoningTokens?: number;
}

export interface AnalysisRequest {
  readonly evidence: CaseEvidence;
  readonly model: string;
  readonly reasoningEffort: ReasoningEffort;
}

export interface AnalyzerResponse {
  readonly model: string;
  readonly output: unknown;
  readonly usage?: AnalysisUsage;
}

export interface Analyzer {
  analyze(request: AnalysisRequest): Promise<AnalyzerResponse>;
}

export interface AnalysisMetadata {
  readonly model: string;
  readonly reasoningEffort: ReasoningEffort;
  readonly usage?: AnalysisUsage;
}

export interface Finding extends FindingClaims {
  readonly schemaVersion: 1;
  readonly analysis: AnalysisMetadata;
}

export interface AnalyzeEvidenceOptions {
  readonly analyzer: Analyzer;
  readonly model?: string;
  readonly reasoningEffort?: ReasoningEffort;
}

const nonEmptyText = z.string().trim().min(1);
const evidenceReferenceSchema: z.ZodType<EvidenceReference> = z.strictObject({
  kind: z.enum(["conversation", "error", "network", "page", "screenshot", "timing"]),
  locator: nonEmptyText,
});
const citedReferences = z.array(evidenceReferenceSchema).min(1);

export const findingClaimsSchema: z.ZodType<FindingClaims> = z.strictObject({
  sourceRunId: nonEmptyText,
  behavior: z.strictObject({
    classification: z.enum([
      "direct-answer",
      "clarification",
      "guided-action",
      "handoff",
      "refusal",
      "failure",
      "unknown",
    ]),
    claim: nonEmptyText,
    evidenceReferences: citedReferences,
  }),
  apiCandidates: z.array(
    z.strictObject({
      name: nonEmptyText,
      rationale: nonEmptyText,
      confidence: z.enum(["low", "medium", "high"]),
      evidenceReferences: citedReferences,
    }),
  ),
  askOneImplications: z
    .array(
      z.strictObject({
        claim: nonEmptyText,
        evidenceReferences: citedReferences,
      }),
    )
    .min(1),
});

export async function analyzeEvidence(
  evidence: CaseEvidence,
  options: AnalyzeEvidenceOptions,
): Promise<Finding> {
  const model = options.model ?? DEFAULT_ANALYSIS_MODEL;
  const reasoningEffort = options.reasoningEffort ?? DEFAULT_REASONING_EFFORT;
  const response = await options.analyzer.analyze({ evidence, model, reasoningEffort });
  const parsed = findingClaimsSchema.safeParse(response.output);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${formatPath(issue.path)}: ${issue.message}`)
      .join("; ");
    throw new Error(`Analyzer returned an invalid finding: ${details}`);
  }
  const finding = normalizeFindingClaims(parsed.data, evidence);
  validateFindingClaims(finding, evidence);
  return {
    ...finding,
    schemaVersion: 1,
    analysis: {
      model: response.model,
      reasoningEffort,
      ...(typeof response.usage === "undefined" ? {} : { usage: response.usage }),
    },
  };
}

function normalizeFindingClaims(finding: FindingClaims, evidence: CaseEvidence): FindingClaims {
  const normalizeReference = (reference: EvidenceReference): EvidenceReference =>
    normalizeEvidenceReference(reference, evidence);
  return {
    ...finding,
    behavior: {
      ...finding.behavior,
      evidenceReferences: finding.behavior.evidenceReferences.map(normalizeReference),
    },
    apiCandidates: finding.apiCandidates.map((candidate) => ({
      ...candidate,
      evidenceReferences: candidate.evidenceReferences.map(normalizeReference),
    })),
    askOneImplications: finding.askOneImplications.map((implication) => ({
      ...implication,
      evidenceReferences: implication.evidenceReferences.map(normalizeReference),
    })),
  };
}

function normalizeEvidenceReference(
  reference: EvidenceReference,
  evidence: CaseEvidence,
): EvidenceReference {
  const redundantPrefix = `${reference.kind}:`;
  const normalized = reference.locator.startsWith(redundantPrefix)
    ? { ...reference, locator: reference.locator.slice(redundantPrefix.length) }
    : reference;

  if (normalized.kind !== "network" || !/^\d+$/u.test(normalized.locator)) {
    return normalized;
  }

  const capturedIds = new Set(evidence.network.map(({ id }) => id));
  if (capturedIds.has(normalized.locator)) {
    return normalized;
  }

  const requestId = `request-${normalized.locator}`;
  return capturedIds.has(requestId) ? { ...normalized, locator: requestId } : normalized;
}

export function validateFindingClaims(finding: FindingClaims, evidence: CaseEvidence): void {
  if (finding.sourceRunId !== evidence.runId) {
    throw new Error(
      `Analyzer returned an invalid finding: sourceRunId must be "${evidence.runId}".`,
    );
  }
  validateEvidenceReferences(finding, evidence);
}

function validateEvidenceReferences(finding: FindingClaims, evidence: CaseEvidence): void {
  const supported = collectEvidenceReferences(evidence);
  for (const reference of collectFindingReferences(finding)) {
    if (!supported.has(referenceKey(reference))) {
      throw new Error(
        `Analyzer returned unsupported evidence reference ${reference.kind}:${reference.locator} for run "${evidence.runId}".`,
      );
    }
  }
}

function collectEvidenceReferences(evidence: CaseEvidence): ReadonlySet<string> {
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

function collectFindingReferences(finding: FindingClaims): readonly EvidenceReference[] {
  return [
    ...finding.behavior.evidenceReferences,
    ...finding.apiCandidates.flatMap(({ evidenceReferences }) => evidenceReferences),
    ...finding.askOneImplications.flatMap(({ evidenceReferences }) => evidenceReferences),
  ];
}

function referenceKey(reference: EvidenceReference): string {
  return `${reference.kind}:${reference.locator}`;
}

function formatPath(path: readonly PropertyKey[]): string {
  return path.length === 0 ? "finding" : path.map(String).join(".");
}
