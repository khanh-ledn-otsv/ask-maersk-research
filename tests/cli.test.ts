import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { runCli } from "../src/cli/run-cli.ts";
import type { BrowserRecorder } from "../src/recording/record-research-session.ts";
import { createTemporaryDirectoryTracker } from "./support/temp-directories.ts";

const temporaryDirectories = createTemporaryDirectoryTracker();

afterEach(() => temporaryDirectories.cleanup());

describe("research CLI", () => {
  test("record creates evidence from environment configuration without an AI key", async () => {
    const outputRoot = await temporaryDirectories.create("maersk-research-cli-");
    const output: string[] = [];
    const browser: BrowserRecorder = {
      async capture(input) {
        expect(input.targetUrl).toBe("https://example.test/ask-maersk");
        await input.waitForCompletion();
        return {
          page: { url: input.targetUrl, title: "Ask Maersk" },
          conversation: [
            {
              index: 0,
              role: "user",
              text: "Track my shipment",
              timestamp: "2026-08-25T16:00:00.000Z",
            },
            {
              index: 1,
              role: "assistant",
              text: "Please provide a shipment identifier.",
              timestamp: "2026-08-25T16:00:01.000Z",
              screenshot: "screenshots/02-result.png",
            },
          ],
          screenshots: [
            { filename: "01-start.png", kind: "start", data: Buffer.from("start") },
            { filename: "02-result.png", kind: "result", data: Buffer.from("result") },
          ],
          network: [],
          timings: { submittedAt: "2026-08-25T16:00:00.000Z" },
          errors: [],
        };
      },
    };

    const exitCode = await runCli(["record"], {
      browser,
      createRunId: () => "cli-test",
      environment: {
        ASK_MAERSK_URL: "https://example.test/ask-maersk",
        RESEARCH_OUTPUT_DIR: outputRoot,
      },
      now: () => new Date("2026-08-25T16:00:00.000Z"),
      stdout: (message) => output.push(message),
      waitForCompletion: async () => undefined,
    });

    expect(exitCode).toBe(0);
    expect(output.join("\n")).toContain("2026-08-25_160000_cli-test");
    const evidence = await readFile(
      join(outputRoot, "2026-08-25_160000_cli-test", "evidence.json"),
      "utf8",
    );
    expect(evidence).toContain("Track my shipment");
  });

  test("record reports missing target configuration without launching a browser", async () => {
    const errors: string[] = [];
    const browser: BrowserRecorder = {
      async capture() {
        throw new Error("browser should not launch");
      },
    };

    const exitCode = await runCli(["record"], {
      browser,
      createRunId: () => "unused",
      environment: {},
      now: () => new Date("2026-08-25T16:00:00.000Z"),
      stderr: (message) => errors.push(message),
      stdout: () => undefined,
      waitForCompletion: async () => undefined,
    });

    expect(exitCode).toBe(1);
    expect(errors).toEqual([
      "ASK_MAERSK_URL is required. Set it in .env or pass --url <url>.",
    ]);
  });
});
