import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type {
  AnalysisUsage,
  ApiCandidateFinding,
  AskOneImplicationFinding,
  EvidenceReference,
  Finding,
} from "../analysis/analyze-evidence.ts";
import type { CorpusCaseResult, CorpusSummary } from "../corpus/run-research-corpus.ts";
import type { CaseEvidence, NetworkEvidence } from "../domain/evidence.ts";

interface LoadedCase {
  readonly result: Extract<CorpusCaseResult, { status: "completed" }>;
  readonly evidence: CaseEvidence;
  readonly evidencePath: string;
  readonly finding: Finding;
  readonly supportedReferences: ReadonlySet<string>;
}

interface UnavailableCase {
  readonly caseId: string;
  readonly reason: string;
}

interface ReportData {
  readonly available: readonly LoadedCase[];
  readonly unavailable: readonly UnavailableCase[];
}

export interface GenerateResearchReportInput {
  readonly outputPath: string;
  readonly summaryPath: string;
}

export interface GeneratedResearchReport {
  readonly outputPath: string;
}

export async function generateResearchReport(
  input: GenerateResearchReportInput,
): Promise<GeneratedResearchReport> {
  const summary = await readJson<CorpusSummary>(input.summaryPath);
  assertCorpusSummary(summary, input.summaryPath);
  const data = await loadReportData(summary, input.summaryPath);
  const markdown = await renderReport(summary, data, input.outputPath);
  await mkdir(dirname(input.outputPath), { recursive: true });
  await writeFile(input.outputPath, markdown, { flag: "wx" });
  return { outputPath: input.outputPath };
}

async function loadReportData(
  summary: CorpusSummary,
  summaryPath: string,
): Promise<ReportData> {
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
        supportedReferences: collectSupportedReferences(evidence),
      });
    } catch (error: unknown) {
      unavailable.push({
        caseId: result.caseId,
        reason: `evidence unavailable: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  return { available, unavailable };
}

async function renderReport(
  summary: CorpusSummary,
  data: ReportData,
  outputPath: string,
): Promise<string> {
  const lines: string[] = [
    "# Ask Maersk Research Report",
    "",
    `Corpus run: ${escapeMarkdown(summary.corpusRunId)}  `,
    `Completed: ${escapeMarkdown(summary.completedAt)}  `,
    `Coverage: ${data.available.length} evidence-backed case${data.available.length === 1 ? "" : "s"} of ${summary.cases.length}`,
    "",
    "## Capability Map",
    "",
    "| Category | Cases | Evidence-backed capability observations |",
    "|---|---:|---|",
    ...renderCapabilityMap(data.available, outputPath),
    "",
    "## Representative User Journeys",
    "",
    ...renderJourneys(data.available, outputPath),
    "",
    "## Primary Evidence Matrix",
    "",
    "| Case | Observation | Evidence | Architecture inference | Ask ONE implication |",
    "|---|---|---|---|---|",
    ...renderPrimaryMatrix(data.available, outputPath),
    "",
    "## Observed Architecture Patterns",
    "",
    ...renderArchitecturePatterns(data.available, outputPath),
    "",
    "## Strengths and Weaknesses",
    "",
    "### Strengths",
    "",
    ...renderBehaviorGroup(data.available, outputPath, [
      "clarification",
      "direct-answer",
      "guided-action",
    ]),
    "",
    "### Weaknesses",
    "",
    ...renderBehaviorGroup(data.available, outputPath, [
      "failure",
      "handoff",
      "refusal",
      "unknown",
    ]),
    "",
    "## Ask ONE Implications",
    "",
    ...renderImplications(data.available, outputPath),
    "",
    "## Evidence Highlights",
    "",
    ...await renderEvidenceHighlights(data.available, outputPath),
    "",
    "## Analysis Cost",
    "",
    ...renderAnalysisCost(summary, data.available),
    "",
    "## Evidence Gaps and Uncertainty",
    "",
    ...renderEvidenceGaps(data),
    "",
  ];
  return `${lines.join("\n").replace(/\n{3,}/gu, "\n\n")}\n`;
}

function renderCapabilityMap(cases: readonly LoadedCase[], outputPath: string): string[] {
  const categories = new Map<string, LoadedCase[]>();
  for (const case_ of cases) {
    const group = categories.get(case_.result.category) ?? [];
    group.push(case_);
    categories.set(case_.result.category, group);
  }
  if (categories.size === 0) return ["| No evidence-backed categories | 0 | Unavailable in this run |"];
  return [...categories.entries()].map(([category, categoryCases]) => {
    const observations = categoryCases
      .filter(hasSupportedBehavior)
      .map((case_) =>
        `${escapeTableCell(case_.finding.behavior.claim)} ${renderReferences(case_, case_.finding.behavior.evidenceReferences, outputPath)}`,
      )
      .join("<br>");
    return `| ${escapeTableCell(category)} | ${categoryCases.length} | ${observations || "No supported observation"} |`;
  });
}

function renderJourneys(cases: readonly LoadedCase[], outputPath: string): string[] {
  const journeys = cases.filter(hasSupportedBehavior).map((case_) => {
    const turns = case_.evidence.conversation.slice(0, 4).map((turn) =>
      `- **${turn.role === "user" ? "User" : "Ask Maersk"}:** ${escapeMarkdown(turn.text)} ${renderReferences(case_, [{ kind: "conversation", locator: String(turn.index) }], outputPath)}`,
    );
    return [
      `### ${escapeMarkdown(case_.result.caseId)} — ${escapeMarkdown(case_.result.objective)}`,
      "",
      ...turns,
      "",
      `Outcome: ${escapeMarkdown(case_.finding.behavior.claim)} ${renderReferences(case_, case_.finding.behavior.evidenceReferences, outputPath)}`,
    ];
  }).flat();
  return journeys.length === 0
    ? ["No representative journey has complete, cited evidence in this run."]
    : journeys;
}

function renderPrimaryMatrix(cases: readonly LoadedCase[], outputPath: string): string[] {
  const rows = cases.filter(hasSupportedBehavior).map((case_) => {
    const candidates = supportedCandidates(case_);
    const implications = supportedImplications(case_);
    const allReferences = uniqueReferences([
      ...case_.finding.behavior.evidenceReferences,
      ...candidates.flatMap(({ evidenceReferences }) => evidenceReferences),
      ...implications.flatMap(({ evidenceReferences }) => evidenceReferences),
    ]);
    const architecture = candidates.length === 0
      ? "Uncertain — no cited architecture inference"
      : candidates
          .map(({ name, rationale, confidence }) => `${name}: ${rationale} (${confidence} confidence)`)
          .join("; ");
    const askOne = implications.length === 0
      ? "No cited implication"
      : implications.map(({ claim }) => claim).join("; ");
    return `| ${escapeTableCell(case_.result.caseId)} | ${escapeTableCell(case_.finding.behavior.claim)} | ${renderReferences(case_, allReferences, outputPath)} | ${escapeTableCell(architecture)} | ${escapeTableCell(askOne)} |`;
  });
  return rows.length === 0
    ? ["| No evidence-backed cases | No supported observation | — | Uncertain | No cited implication |"]
    : rows;
}

function renderArchitecturePatterns(cases: readonly LoadedCase[], outputPath: string): string[] {
  const patterns = cases.flatMap((case_) =>
    supportedCandidates(case_).map((candidate) =>
      `- **${escapeMarkdown(candidate.name)} (${candidate.confidence} confidence):** ${escapeMarkdown(candidate.rationale)} ${renderReferences(case_, candidate.evidenceReferences, outputPath)}`,
    ),
  );
  return patterns.length === 0
    ? ["No architecture pattern is supported by cited evidence in this run."]
    : patterns;
}

function renderBehaviorGroup(
  cases: readonly LoadedCase[],
  outputPath: string,
  classifications: readonly Finding["behavior"]["classification"][],
): string[] {
  const matching = cases
    .filter((case_) => classifications.includes(case_.finding.behavior.classification))
    .filter(hasSupportedBehavior)
    .map((case_) =>
      `- **${escapeMarkdown(case_.result.caseId)}:** ${escapeMarkdown(case_.finding.behavior.claim)} ${renderReferences(case_, case_.finding.behavior.evidenceReferences, outputPath)}`,
    );
  return matching.length === 0
    ? ["No cited observation in the available cases falls into this group."]
    : matching;
}

function renderImplications(cases: readonly LoadedCase[], outputPath: string): string[] {
  const seen = new Set<string>();
  const implications = cases.flatMap((case_) =>
    supportedImplications(case_).flatMap((implication) => {
      if (seen.has(implication.claim)) return [];
      seen.add(implication.claim);
      return [
        `- ${escapeMarkdown(implication.claim)} ${renderReferences(case_, implication.evidenceReferences, outputPath)}`,
      ];
    }),
  ).slice(0, 10);
  return implications.length === 0
    ? ["No Ask ONE implication is supported by cited evidence in this run."]
    : implications;
}

async function renderEvidenceHighlights(
  cases: readonly LoadedCase[],
  outputPath: string,
): Promise<string[]> {
  const screenshots: { case_: LoadedCase; reference: EvidenceReference }[] = [];
  const networks: { case_: LoadedCase; candidate: ApiCandidateFinding; reference: EvidenceReference }[] = [];
  const screenshotKeys = new Set<string>();
  const networkKeys = new Set<string>();
  for (const case_ of cases) {
    const claimReferences = [
      ...case_.finding.behavior.evidenceReferences,
      ...supportedCandidates(case_).flatMap(({ evidenceReferences }) => evidenceReferences),
      ...supportedImplications(case_).flatMap(({ evidenceReferences }) => evidenceReferences),
    ];
    for (const reference of claimReferences) {
      const key = `${case_.result.caseId}:${reference.kind}:${reference.locator}`;
      if (reference.kind === "screenshot" && !screenshotKeys.has(key)) {
        screenshotKeys.add(key);
        const target = join(dirname(case_.evidencePath), reference.locator);
        if (await fileExists(target)) screenshots.push({ case_, reference });
      }
    }
    for (const candidate of supportedCandidates(case_)) {
      for (const reference of candidate.evidenceReferences) {
        const key = `${case_.result.caseId}:${reference.kind}:${reference.locator}`;
        if (reference.kind === "network" && !networkKeys.has(key)) {
          networkKeys.add(key);
          networks.push({ case_, candidate, reference });
        }
      }
    }
  }
  const lines = ["### Screenshots", ""];
  if (screenshots.length === 0) {
    lines.push("No cited screenshot file is available in this run.");
  } else {
    for (const { case_, reference } of screenshots.slice(0, 12)) {
      const target = join(dirname(case_.evidencePath), reference.locator);
      lines.push(
        `- [${escapeLinkLabel(`${case_.result.caseId}: ${case_.finding.behavior.claim}`)}](${linkTarget(outputPath, target)})`,
      );
    }
  }
  lines.push("", "### Network / API Examples", "");
  if (networks.length === 0) {
    lines.push("No cited network/API example is available in this run.");
  } else {
    for (const { case_, candidate, reference } of networks.slice(0, 3)) {
      const network = case_.evidence.network.find(({ id }) => id === reference.locator);
      lines.push(
        `- **${escapeMarkdown(candidate.name)}:** ${escapeMarkdown(formatNetwork(network, reference.locator))} ${renderReferences(case_, [reference], outputPath)}`,
      );
    }
  }
  return lines;
}

function renderAnalysisCost(
  summary: CorpusSummary,
  cases: readonly LoadedCase[],
): string[] {
  const usage = summary.aggregateUsage;
  const modelCounts = new Map<string, number>();
  for (const case_ of cases) {
    const model = case_.finding.analysis.model;
    modelCounts.set(model, (modelCounts.get(model) ?? 0) + 1);
  }
  const actualModels = [...modelCounts.entries()]
    .map(([model, count]) => `\`${escapeCode(model)}\` (${count} case${count === 1 ? "" : "s"})`)
    .join(", ");
  return [
    `- Model policy: \`${escapeCode(summary.analysisPolicy.model)}\``,
    `- Actual analyzed models: ${actualModels || "unavailable"}`,
    `- Reasoning effort: \`${escapeCode(summary.analysisPolicy.reasoningEffort)}\``,
    `- Recorded token cost: input ${formatUsage(usage, "inputTokens")}; cached input ${formatUsage(usage, "cachedInputTokens")}; output ${formatUsage(usage, "outputTokens")}; reasoning ${formatUsage(usage, "reasoningTokens")}.`,
    "- Monetary cost is not estimated because the corpus does not capture the model price in effect at analysis time.",
  ];
}

function renderEvidenceGaps(data: ReportData): string[] {
  if (data.unavailable.length === 0) {
    return ["All reported observations have supported references in available evidence files."];
  }
  return [
    "The following cases are excluded from factual synthesis until evidence is available:",
    "",
    ...data.unavailable.map(
      ({ caseId, reason }) => `- **${escapeMarkdown(caseId)}:** ${escapeMarkdown(reason)}`,
    ),
  ];
}

function hasSupportedBehavior(case_: LoadedCase): boolean {
  return referencesSupported(case_, case_.finding.behavior.evidenceReferences);
}

function supportedCandidates(case_: LoadedCase): readonly ApiCandidateFinding[] {
  return case_.finding.apiCandidates.filter(({ evidenceReferences }) =>
    referencesSupported(case_, evidenceReferences),
  );
}

function supportedImplications(case_: LoadedCase): readonly AskOneImplicationFinding[] {
  return case_.finding.askOneImplications.filter(({ evidenceReferences }) =>
    referencesSupported(case_, evidenceReferences),
  );
}

function referencesSupported(
  case_: LoadedCase,
  references: readonly EvidenceReference[],
): boolean {
  return references.length > 0 && references.every((reference) =>
    case_.supportedReferences.has(referenceKey(reference))
  );
}

function renderReferences(
  case_: LoadedCase,
  references: readonly EvidenceReference[],
  outputPath: string,
): string {
  return uniqueReferences(references)
    .filter((reference) => case_.supportedReferences.has(referenceKey(reference)))
    .map((reference) => {
      const target = reference.kind === "screenshot"
        ? join(dirname(case_.evidencePath), reference.locator)
        : case_.evidencePath;
      return `[${escapeLinkLabel(referenceLabel(reference))}](${linkTarget(outputPath, target)})`;
    })
    .join(", ");
}

function collectSupportedReferences(evidence: CaseEvidence): ReadonlySet<string> {
  return new Set([
    "page:page",
    ...evidence.conversation.map(({ index }) => `conversation:${index}`),
    ...evidence.screenshots.map(({ path }) => `screenshot:${path}`),
    ...evidence.network.map(({ id }) => `network:${id}`),
    ...evidence.timings.map(({ turnIndex }) => `timing:${turnIndex}`),
    ...evidence.errors.map((_, index) => `error:${index}`),
  ]);
}

function uniqueReferences(references: readonly EvidenceReference[]): readonly EvidenceReference[] {
  const seen = new Set<string>();
  return references.filter((reference) => {
    const key = referenceKey(reference);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function referenceKey(reference: EvidenceReference): string {
  return `${reference.kind}:${reference.locator}`;
}

function referenceLabel(reference: EvidenceReference): string {
  if (reference.kind === "conversation") return `conversation turn ${reference.locator}`;
  if (reference.kind === "timing") return `timing turn ${reference.locator}`;
  if (reference.kind === "error") return `recorded error ${reference.locator}`;
  if (reference.kind === "page") return "captured page";
  if (reference.kind === "network") return `network ${reference.locator}`;
  return `screenshot ${reference.locator}`;
}

function resolveArtifactPath(path: string, summaryPath: string): string {
  return isAbsolute(path) ? path : resolve(dirname(summaryPath), path);
}

function linkTarget(outputPath: string, targetPath: string): string {
  const path = relative(dirname(outputPath), targetPath);
  const encoded = path.split(sep).map((segment) => encodeURIComponent(segment)).join("/");
  return encoded.startsWith(".") ? encoded : `./${encoded}`;
}

function escapeTableCell(value: string): string {
  return value
    .split(/\r?\n/gu)
    .map(escapeMarkdown)
    .join("<br>")
    .replaceAll("|", "\\|");
}

function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_[\]<>])/gu, "\\$1").replace(/\r?\n/gu, " ");
}

function escapeLinkLabel(value: string): string {
  return escapeMarkdown(value);
}

function escapeCode(value: string): string {
  return value.replaceAll("`", "\\`");
}

function formatUsage(usage: AnalysisUsage, key: keyof AnalysisUsage): string {
  return typeof usage[key] === "undefined" ? "not returned" : String(usage[key]);
}

function formatNetwork(network: NetworkEvidence | undefined, locator: string): string {
  return typeof network === "undefined"
    ? `network request ${locator}`
    : `${network.method} ${network.url}${typeof network.status === "undefined" ? "" : ` (${network.status})`}`;
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
