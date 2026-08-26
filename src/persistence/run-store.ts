import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  CaseEvidence,
  ScreenshotCapture,
  TraceCapture,
} from "../domain/evidence.ts";

export interface PersistRunInput {
  readonly evidence: Omit<CaseEvidence, "trace">;
  readonly runDirectory: string;
  readonly screenshots: readonly ScreenshotCapture[];
  readonly trace?: TraceCapture;
}

export async function persistRun(input: PersistRunInput): Promise<void> {
  const evidence: CaseEvidence = {
    ...input.evidence,
    ...(typeof input.trace === "undefined"
      ? {}
      : { trace: { path: `trace/${input.trace.filename}` } }),
  };
  const screenshotsDirectory = join(input.runDirectory, "screenshots");
  const networkDirectory = join(input.runDirectory, "network");

  await mkdir(dirname(input.runDirectory), { recursive: true });
  await mkdir(input.runDirectory);
  await mkdir(screenshotsDirectory);
  await mkdir(networkDirectory);
  if (typeof input.trace !== "undefined") {
    await mkdir(join(input.runDirectory, "trace"));
  }

  await Promise.all(
    input.screenshots.map((screenshot) =>
      writeFile(join(screenshotsDirectory, screenshot.filename), screenshot.data, {
        flag: "wx",
      }),
    ),
  );

  const json = `${JSON.stringify(evidence, null, 2)}\n`;
  const conversationJson = `${JSON.stringify(evidence.conversation, null, 2)}\n`;
  const metadataJson = `${JSON.stringify(
    {
      ...(typeof evidence.caseId === "undefined"
        ? {}
        : { caseId: evidence.caseId }),
      runId: evidence.runId,
      startedAt: evidence.startedAt,
      completedAt: evidence.completedAt,
      page: evidence.page,
    },
    null,
    2,
  )}\n`;
  const networkJsonLines = evidence.network
    .map((entry) => JSON.stringify(entry))
    .join("\n");

  await Promise.all([
    writeFile(join(input.runDirectory, "evidence.json"), json, { flag: "wx" }),
    writeFile(join(input.runDirectory, "conversation.json"), conversationJson, { flag: "wx" }),
    writeFile(join(input.runDirectory, "metadata.json"), metadataJson, { flag: "wx" }),
    writeFile(
      join(networkDirectory, "requests.jsonl"),
      networkJsonLines.length === 0 ? "" : `${networkJsonLines}\n`,
      { flag: "wx" },
    ),
    ...(typeof input.trace === "undefined"
      ? []
      : [
          writeFile(
            join(input.runDirectory, "trace", input.trace.filename),
            input.trace.data,
            { flag: "wx" },
          ),
        ]),
  ]);
}
