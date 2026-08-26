import { readFile } from "node:fs/promises";

export async function loadApprovedTestData(
  path: string | undefined,
): Promise<Readonly<Record<string, string>>> {
  if (typeof path === "undefined") return {};
  const value = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Approved test-data file must contain a JSON object: ${path}.`);
  }
  const entries = Object.entries(value);
  if (entries.some(([, item]) => typeof item !== "string" || item.trim().length === 0)) {
    throw new Error(`Approved test-data values must be non-empty strings: ${path}.`);
  }
  return Object.fromEntries(entries) as Readonly<Record<string, string>>;
}
