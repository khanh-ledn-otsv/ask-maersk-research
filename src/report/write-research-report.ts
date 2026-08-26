import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { renderResearchReport } from "./generate-research-report.ts";
import { loadReportData } from "./report-data.ts";

export interface WriteResearchReportInput {
  readonly outputPath: string;
  readonly summaryPath: string;
}

export interface WrittenResearchReport {
  readonly outputPath: string;
}

export async function writeResearchReport(
  input: WriteResearchReportInput,
): Promise<WrittenResearchReport> {
  const { data, summary } = await loadReportData(input.summaryPath);
  const markdown = renderResearchReport(summary, data, input.outputPath);
  await mkdir(dirname(input.outputPath), { recursive: true });
  await writeFile(input.outputPath, markdown, { flag: "wx" });
  return { outputPath: input.outputPath };
}
