import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { loadResearchCases } from "../src/cases/load-research-cases.ts";
import { RESEARCH_CATEGORIES } from "../src/domain/research-case.ts";
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
        messages: [
          { text: "Track my shipment" },
          { text: "Use booking reference ABC123 instead" },
        ],
      }),
    );

    await expect(loadResearchCases(casesDirectory)).resolves.toEqual([
      {
        id: "TRACK-001",
        category: "TRACKING",
        objective: "Observe clarification when a shipment identifier is missing",
        authenticated: false,
        dataPolicy: "public",
        executionMode: "manual",
        messages: [
          { text: "Track my shipment" },
          { text: "Use booking reference ABC123 instead" },
        ],
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
      /Invalid research case invalid\.json:.*id: must not be empty.*category:.*objective: must not be empty.*messages: must contain at least one message.*case: Unrecognized key/u,
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

  test("ships a bounded representative corpus across every research category", async () => {
    const cases = await loadResearchCases(join(process.cwd(), "cases"));

    expect(cases.length).toBeGreaterThanOrEqual(15);
    expect(cases.length).toBeLessThanOrEqual(25);
    expect(new Set(cases.map(({ category }) => category))).toEqual(
      new Set(RESEARCH_CATEGORIES),
    );
    const casesUsingControlledData = cases.filter(({ dataPolicy }) => dataPolicy !== "public");
    expect(casesUsingControlledData.length).toBeGreaterThan(0);
    expect(
      cases.filter(({ dataPolicy }) => dataPolicy === "fake")
        .every(({ executionMode }) => executionMode === "automated"),
    ).toBe(true);
    expect(
      cases.filter(({ dataPolicy, executionMode }) =>
        dataPolicy === "authorized" && executionMode === "automated"
      ).every(({ testDataPlaceholders }) => (testDataPlaceholders?.length ?? 0) > 0),
    ).toBe(true);
    expect(
      casesUsingControlledData.every(({ notes }) =>
        /fake|authorized/iu.test(notes ?? ""),
      ),
    ).toBe(true);
  });
});
