import { join } from "node:path";
import { generateResearchReport } from "../report/generate-research-report.ts";
import { parseFlags } from "./parse-flags.ts";

export interface ReportCliDependencies {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly stdout: (message: string) => void;
}

export async function runReport(
  arguments_: readonly string[],
  dependencies: ReportCliDependencies,
  stderr: (message: string) => void,
): Promise<number> {
  const [summaryPath, ...flags] = arguments_;
  if (typeof summaryPath === "undefined" || summaryPath.startsWith("--")) {
    stderr("Usage: pnpm research report <corpus-summary> [--output <report-path>]");
    return 1;
  }
  const parsed = parseFlags(flags, ["--output"]);
  if (!parsed.ok) {
    stderr(parsed.message);
    return 1;
  }
  const outputPath =
    parsed.values.get("--output") ??
    dependencies.environment.RESEARCH_REPORT_PATH ??
    join(process.cwd(), "reports", "maersk-research.md");
  try {
    const result = await generateResearchReport({ outputPath, summaryPath });
    dependencies.stdout(`Research report saved: ${result.outputPath}`);
    return 0;
  } catch (error: unknown) {
    stderr(`Report generation failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
