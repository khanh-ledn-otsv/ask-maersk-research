import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  CaseEvidence,
  ScreenshotCapture,
} from "../domain/evidence.ts";

export interface PersistRunInput {
  readonly evidence: CaseEvidence;
  readonly runDirectory: string;
  readonly screenshots: readonly ScreenshotCapture[];
}

export async function persistRun(input: PersistRunInput): Promise<void> {
  const screenshotsDirectory = join(input.runDirectory, "screenshots");
  const networkDirectory = join(input.runDirectory, "network");

  await mkdir(dirname(input.runDirectory), { recursive: true });
  await mkdir(input.runDirectory);
  await mkdir(screenshotsDirectory);
  await mkdir(networkDirectory);

  await Promise.all(
    input.screenshots.map((screenshot) =>
      writeFile(join(screenshotsDirectory, screenshot.filename), screenshot.data, {
        flag: "wx",
      }),
    ),
  );

  const json = `${JSON.stringify(input.evidence, null, 2)}\n`;
  const conversationJson = `${JSON.stringify(input.evidence.conversation, null, 2)}\n`;
  const metadataJson = `${JSON.stringify(
    {
      runId: input.evidence.runId,
      startedAt: input.evidence.startedAt,
      completedAt: input.evidence.completedAt,
      page: input.evidence.page,
    },
    null,
    2,
  )}\n`;
  const networkJsonLines = input.evidence.network
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
  ]);
}
