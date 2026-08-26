import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { loadResearchCases } from "../src/cases/load-research-cases.ts";
import { createTemporaryDirectoryTracker } from "./support/temp-directories.ts";

const temporaryDirectories = createTemporaryDirectoryTracker();

afterEach(() => temporaryDirectories.cleanup());

describe("loadResearchCases", () => {
  test("loads validated cases and applies optional defaults", async () => {
    const casesDirectory = await temporaryDirectories.create("maersk-cases-");
    await writeFile(
      join(casesDirectory, "tracking.json"),
      JSON.stringify({
        id: "TRACK-001",
        category: "TRACKING",
        objective: "Observe clarification when a shipment identifier is missing",
        executionMode: "manual",
        messages: [{ text: "Track my shipment" }],
      }),
    );

    await expect(loadResearchCases(casesDirectory)).resolves.toEqual([
      {
        id: "TRACK-001",
        category: "TRACKING",
        objective: "Observe clarification when a shipment identifier is missing",
        authenticated: false,
        executionMode: "manual",
        messages: [{ text: "Track my shipment" }],
        captureTrace: false,
      },
    ]);
  });

  test("reports every invalid field with its source file and path", async () => {
    const casesDirectory = await temporaryDirectories.create("maersk-cases-");
    await writeFile(
      join(casesDirectory, "invalid.json"),
      JSON.stringify({
        id: "",
        category: "UNKNOWN",
        objective: "",
        executionMode: "manual",
        messages: [],
        unexpected: true,
      }),
    );

    await expect(loadResearchCases(casesDirectory)).rejects.toThrow(
      /Invalid research case invalid\.json:.*id: must not be empty.*category:.*objective: must not be empty.*messages: must contain exactly one message.*case: Unrecognized key/u,
    );
  });

  test("reports both source files for a duplicate case ID", async () => {
    const casesDirectory = await temporaryDirectories.create("maersk-cases-");
    const case_ = {
      id: "TRACK-001",
      category: "TRACKING",
      objective: "Observe tracking",
      executionMode: "manual",
      messages: [{ text: "Track my shipment" }],
    };
    await Promise.all([
      writeFile(join(casesDirectory, "first.json"), JSON.stringify(case_)),
      writeFile(join(casesDirectory, "second.json"), JSON.stringify(case_)),
    ]);

    await expect(loadResearchCases(casesDirectory)).rejects.toThrow(
      'Duplicate research case ID "TRACK-001" in first.json and second.json.',
    );
  });
});
