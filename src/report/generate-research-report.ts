import { dirname, join, relative, sep } from "node:path";
import type {
  AnalysisUsage,
  ApiCandidateFinding,
  AskOneImplicationFinding,
  EvidenceReference,
  Finding,
} from "../analysis/analyze-evidence.ts";
import type { CorpusSummary } from "../corpus/run-research-corpus.ts";
import type { NetworkEvidence } from "../domain/evidence.ts";
import { referenceKey, type LoadedCase, type ReportData } from "./report-data.ts";

export function renderResearchReport(
  summary: CorpusSummary,
  data: ReportData,
  outputPath: string,
): string {
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
    "These are interaction signals, not correctness judgements; answer quality requires separate evaluation.",
    "",
    "### Strengths",
    "",
    ...renderBehaviorGroup(data.available, outputPath, [
      "direct-answer",
      "guided-action",
    ]),
    "",
    "### Weaknesses",
    "",
    ...renderBehaviorGroup(data.available, outputPath, [
      "failure",
      "unknown",
    ]),
    "",
    "### Context-dependent Patterns",
    "",
    ...renderBehaviorGroup(data.available, outputPath, [
      "clarification",
      "handoff",
      "refusal",
    ]),
    "",
    "## Ask ONE Implications",
    "",
    ...renderImplications(data.available, outputPath),
    "",
    "## Evidence Highlights",
    "",
    ...renderEvidenceHighlights(data.available, outputPath),
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
  const journeys = selectRepresentativeCases(cases).map((case_) => {
    const turns = renderJourneyTurns(case_, outputPath);
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

function selectRepresentativeCases(cases: readonly LoadedCase[]): readonly LoadedCase[] {
  const supported = cases.filter(hasSupportedBehavior);
  const selected: LoadedCase[] = [];
  const selectedIds = new Set<string>();
  const categories = new Set<string>();
  for (const case_ of supported) {
    if (categories.has(case_.result.category)) continue;
    selected.push(case_);
    selectedIds.add(case_.result.caseId);
    categories.add(case_.result.category);
    if (selected.length === 5) return selected;
  }
  for (const case_ of supported) {
    if (selectedIds.has(case_.result.caseId)) continue;
    selected.push(case_);
    if (selected.length === 5) break;
  }
  return selected;
}

function renderJourneyTurns(case_: LoadedCase, outputPath: string): string[] {
  const turns = case_.evidence.conversation;
  const selected = turns.length <= 4 ? turns : [...turns.slice(0, 2), ...turns.slice(-2)];
  const lines = selected.map((turn) =>
    `- **${turn.role === "user" ? "User" : "Ask Maersk"}:** ${escapeMarkdown(turn.text)} ${renderReferences(case_, [{ kind: "conversation", locator: String(turn.index) }], outputPath)}`,
  );
  if (turns.length > 4) lines.splice(2, 0, `- _${turns.length - 4} intermediate turns omitted_`);
  return lines;
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

function renderEvidenceHighlights(
  cases: readonly LoadedCase[],
  outputPath: string,
): string[] {
  const screenshots: {
    case_: LoadedCase;
    path: string;
    referenced: boolean;
    score: number;
  }[] = [];
  const networks: {
    candidate?: ApiCandidateFinding;
    case_: LoadedCase;
    network: NetworkEvidence;
    score: number;
  }[] = [];
  for (const case_ of cases) {
    const claimReferences = [
      ...case_.finding.behavior.evidenceReferences,
      ...supportedCandidates(case_).flatMap(({ evidenceReferences }) => evidenceReferences),
      ...supportedImplications(case_).flatMap(({ evidenceReferences }) => evidenceReferences),
    ];
    const referencedScreenshots = new Set(
      claimReferences
        .filter(({ kind }) => kind === "screenshot")
        .map(({ locator }) => locator),
    );
    for (const screenshot of case_.evidence.screenshots) {
      const target = join(dirname(case_.evidencePath), screenshot.path);
      if (!case_.availableScreenshotPaths.has(screenshot.path)) continue;
      const referenced = referencedScreenshots.has(screenshot.path);
      const kindScore = screenshot.kind === "result" ? 30 : screenshot.kind === "error" ? 20 : 0;
      screenshots.push({
        case_,
        path: screenshot.path,
        referenced,
        score: (referenced ? 100 : 0) + kindScore,
      });
    }
    const candidates = supportedCandidates(case_);
    for (const network of case_.evidence.network) {
      const candidate = candidates.find(({ evidenceReferences }) =>
        evidenceReferences.some(
          ({ kind, locator }) => kind === "network" && locator === network.id,
        )
      );
      const bodyScore = typeof network.requestBody === "undefined" &&
          typeof network.responseBody === "undefined"
        ? 0
        : 20;
      networks.push({
        case_,
        network,
        score: (typeof candidate === "undefined" ? 0 : 100) +
          (typeof network.status === "undefined" ? 0 : 10) + bodyScore,
        ...(typeof candidate === "undefined" ? {} : { candidate }),
      });
    }
  }
  screenshots.sort((left, right) => right.score - left.score);
  networks.sort((left, right) => right.score - left.score);
  const lines = ["### Screenshots", ""];
  if (screenshots.length === 0) {
    lines.push("No cited screenshot file is available in this run.");
  } else {
    for (const { case_, path, referenced } of screenshots.slice(0, 12)) {
      const target = join(dirname(case_.evidencePath), path);
      const description = referenced
        ? case_.finding.behavior.claim
        : `${case_.evidence.screenshots.find((entry) => entry.path === path)?.kind ?? "captured"} screenshot`;
      lines.push(
        `- [${escapeLinkLabel(`${case_.result.caseId}: ${description}`)}](${linkTarget(outputPath, target)})`,
      );
    }
  }
  lines.push("", "### Network / API Examples", "");
  if (networks.length === 0) {
    lines.push("No cited network/API example is available in this run.");
  } else {
    for (const { case_, candidate, network } of networks.slice(0, 3)) {
      const label = candidate?.name ?? case_.result.caseId;
      lines.push(
        `- **${escapeMarkdown(label)}:** ${escapeMarkdown(formatNetwork(network, network.id))} ${renderReferences(case_, [{ kind: "network", locator: network.id }], outputPath)}`,
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

function uniqueReferences(references: readonly EvidenceReference[]): readonly EvidenceReference[] {
  const seen = new Set<ReturnType<typeof referenceKey>>();
  return references.filter((reference) => {
    const key = referenceKey(reference);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function referenceLabel(reference: EvidenceReference): string {
  if (reference.kind === "conversation") return `conversation turn ${reference.locator}`;
  if (reference.kind === "timing") return `timing turn ${reference.locator}`;
  if (reference.kind === "error") return `recorded error ${reference.locator}`;
  if (reference.kind === "page") return "captured page";
  if (reference.kind === "network") return `network ${reference.locator}`;
  return `screenshot ${reference.locator}`;
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
