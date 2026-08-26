import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  recordResearchSession,
  type BrowserRecorder,
} from "../src/recording/record-research-session.ts";
import { createTemporaryDirectoryTracker } from "./support/temp-directories.ts";

const temporaryDirectories = createTemporaryDirectoryTracker();

afterEach(() => temporaryDirectories.cleanup());

describe("recordResearchSession", () => {
  test("persists a complete evidence record that does not require AI", async () => {
    const outputRoot = await temporaryDirectories.create("maersk-research-");

    const browser: BrowserRecorder = {
      async capture() {
        return {
          page: {
            url: "https://example.test/chat?mode=guest",
            title: "Ask Maersk",
          },
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
            { filename: "01-start.png", kind: "start", data: Buffer.from("start-image") },
            { filename: "02-result.png", kind: "result", data: Buffer.from("result-image") },
          ],
          network: [
            {
              id: "request-1",
              timestamp: "2026-08-25T16:00:01.000Z",
              method: "POST",
              url: "https://example.test/api?mode=guest",
              resourceType: "fetch",
              status: 200,
              requestHeaders: {
                "content-type": "application/json",
                "x-client-id": "research-fixture",
              },
              requestBody: { question: "Track my shipment", locale: "en" },
              responseHeaders: { "x-request-id": "request-1" },
              responseBody: { answer: "Please provide a shipment identifier." },
              durationMs: 125,
            },
          ],
          timings: {
            submittedAt: "2026-08-25T16:00:00.000Z",
            completedResponseMs: 1_000,
          },
          errors: [],
        };
      },
    };

    const result = await recordResearchSession(
      {
        outputRoot,
        targetUrl: "https://example.test/chat",
        userMessage: "Track my shipment",
        waitForCompletion: async () => undefined,
      },
      {
        browser,
        createRunId: () => "ask-maersk-001",
        now: () => new Date("2026-08-25T16:00:00.000Z"),
      },
    );

    expect(result).toEqual({
      runId: "2026-08-25_160000_ask-maersk-001",
      runDirectory: join(outputRoot, "2026-08-25_160000_ask-maersk-001"),
    });

    const evidence = JSON.parse(
      await readFile(join(result.runDirectory, "evidence.json"), "utf8"),
    ) as unknown;
    expect(evidence).toEqual({
      runId: result.runId,
      startedAt: "2026-08-25T16:00:00.000Z",
      completedAt: "2026-08-25T16:00:00.000Z",
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
        { path: "screenshots/01-start.png", kind: "start" },
        { path: "screenshots/02-result.png", kind: "result" },
      ],
      network: [
        {
          id: "request-1",
          timestamp: "2026-08-25T16:00:01.000Z",
          method: "POST",
          url: "https://example.test/api?mode=guest",
          resourceType: "fetch",
          status: 200,
          requestHeaders: {
            "content-type": "application/json",
            "x-client-id": "research-fixture",
          },
          requestBody: { question: "Track my shipment", locale: "en" },
          responseHeaders: { "x-request-id": "request-1" },
          responseBody: { answer: "Please provide a shipment identifier." },
          durationMs: 125,
        },
      ],
      timings: {
        submittedAt: "2026-08-25T16:00:00.000Z",
        completedResponseMs: 1_000,
      },
      page: {
        url: "https://example.test/chat?mode=guest",
        title: "Ask Maersk",
      },
      errors: [],
    });

    expect(await readFile(join(result.runDirectory, "screenshots/01-start.png"))).toEqual(
      Buffer.from("start-image"),
    );
  });

  test("refuses to write into an existing run directory", async () => {
    const outputRoot = await temporaryDirectories.create("maersk-research-");
    const runDirectory = join(outputRoot, "2026-08-25_160000_collision");
    await mkdir(runDirectory);
    const browser: BrowserRecorder = {
      async capture() {
        return {
          page: { url: "https://example.test/", title: "Ask Maersk" },
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
              text: "Answer",
              timestamp: "2026-08-25T16:00:01.000Z",
            },
          ],
          screenshots: [],
          network: [],
          timings: { submittedAt: "2026-08-25T16:00:00.000Z" },
          errors: [],
        };
      },
    };

    await expect(
      recordResearchSession(
        {
          outputRoot,
          targetUrl: "https://example.test/",
          userMessage: "Track my shipment",
          waitForCompletion: async () => undefined,
        },
        {
          browser,
          createRunId: () => "collision",
          now: () => new Date("2026-08-25T16:00:00.000Z"),
        },
      ),
    ).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readdir(runDirectory)).toEqual([]);
  });

});
