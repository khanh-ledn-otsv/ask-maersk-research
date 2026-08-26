import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  RESEARCH_CATEGORIES,
  type ResearchCase,
} from "../domain/research-case.ts";

const nonEmptyText = z.string().trim().min(1, "must not be empty");
const researchCaseSchema = z.strictObject({
  id: nonEmptyText,
  category: z.enum(RESEARCH_CATEGORIES),
  objective: nonEmptyText,
  authenticated: z.boolean().default(false),
  dataPolicy: z.enum(["authorized", "fake", "public"]).default("public"),
  executionMode: z.enum(["automated", "manual"]),
  messages: z
    .array(z.strictObject({ text: nonEmptyText }))
    .min(1, "must contain at least one message"),
  captureTrace: z.boolean().default(false),
  notes: nonEmptyText.optional(),
});

export async function loadResearchCases(
  casesDirectory: string,
): Promise<readonly ResearchCase[]> {
  const filenames = (await readdir(casesDirectory))
    .filter((filename) => filename.endsWith(".json"))
    .toSorted();
  const cases: ResearchCase[] = [];
  const sourceById = new Map<string, string>();

  for (const filename of filenames) {
    const case_ = await readResearchCase(join(casesDirectory, filename), filename);
    const previousSource = sourceById.get(case_.id);
    if (typeof previousSource !== "undefined") {
      throw new Error(
        `Duplicate research case ID "${case_.id}" in ${previousSource} and ${filename}.`,
      );
    }
    sourceById.set(case_.id, filename);
    cases.push(case_);
  }

  return cases;
}

async function readResearchCase(path: string, filename: string): Promise<ResearchCase> {
  const source = await readFile(path, "utf8");
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON in research case ${filename}: ${detail}`, { cause: error });
  }

  const result = researchCaseSchema.safeParse(value);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${formatPath(issue.path)}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid research case ${filename}: ${details}`);
  }
  const { notes, ...required } = result.data;
  return typeof notes === "undefined" ? required : { ...required, notes };
}

function formatPath(path: readonly PropertyKey[]): string {
  return path.length === 0 ? "case" : path.map(String).join(".");
}
