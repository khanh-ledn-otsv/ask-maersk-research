import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { loadResearchCases } from "../cases/load-research-cases.ts";
import { prepareUnattendedCase } from "../cases/prepare-unattended-case.ts";
import {
  RESEARCH_CATEGORIES,
  type ResearchCase,
  type ResearchCategory,
} from "../domain/research-case.ts";
import type { BrowserRecorder } from "../recording/record-research-session.ts";
import { parseFlags } from "./parse-flags.ts";

export interface PreflightCliDependencies {
  readonly browser: BrowserRecorder;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly now: () => Date;
  readonly stdout: (message: string) => void;
}

export async function runPreflight(
  arguments_: readonly string[],
  dependencies: PreflightCliDependencies,
  stderr: (message: string) => void,
): Promise<number> {
  const parsed = parseOptions(arguments_, dependencies.environment);
  if (!parsed.ok) {
    stderr(parsed.message);
    return 1;
  }
  if (typeof dependencies.browser.preflight === "undefined") {
    stderr("Browser preflight is not configured.");
    return 1;
  }
  try {
    const [loadedCases, testData] = await Promise.all([
      loadResearchCases(parsed.options.casesDirectory),
      loadTestData(parsed.options.testDataPath),
    ]);
    const cases = selectCases(loadedCases, parsed.options.selection);
    const browser = await dependencies.browser.preflight({
      inputSelector: parsed.options.inputSelector,
      ...(typeof parsed.options.submitSelector === "undefined"
        ? {}
        : { submitSelector: parsed.options.submitSelector }),
      targetUrl: parsed.options.targetUrl,
    });
    const results = cases.map((case_) => {
      const prepared = prepareUnattendedCase(case_, {
        allowAuthorizedData: parsed.options.allowAuthorizedData,
        authenticated: browser.authenticated,
        browserIssues: browser.issues,
        inputSelector: parsed.options.inputSelector,
        ...(typeof parsed.options.submitSelector === "undefined" ? {} : { submitSelector: parsed.options.submitSelector }),
        testData,
      });
      return {
        caseId: case_.id,
        ...(prepared.ok
          ? { status: "preflight-ready" as const }
          : { status: "preflight-required" as const, reasons: [prepared.reason] }),
      };
    });
    for (const result of results) {
      dependencies.stdout(
        result.status === "preflight-ready"
          ? `${result.caseId}: preflight-ready`
          : `${result.caseId}: preflight-required — ${result.reasons.join("; ")}`,
      );
    }
    await mkdir(dirname(parsed.options.receiptPath), { recursive: true });
    await writeFile(
      parsed.options.receiptPath,
      `${JSON.stringify({
        schemaVersion: 1,
        passedAt: dependencies.now().toISOString(),
        targetUrl: browser.pageUrl,
        inputSelector: parsed.options.inputSelector,
        ...(typeof parsed.options.submitSelector === "undefined"
          ? {}
          : { submitSelector: parsed.options.submitSelector }),
        cases: results,
      }, null, 2)}\n`,
      { flag: "w" },
    );
    dependencies.stdout(`Preflight receipt saved: ${parsed.options.receiptPath}`);
    return 0;
  } catch (error: unknown) {
    stderr(`Preflight failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

type Selection = { readonly all: true } | { readonly caseId: string } | { readonly category: ResearchCategory };

type OptionsResult =
  | {
      readonly ok: true;
      readonly options: {
        readonly casesDirectory: string;
        readonly allowAuthorizedData: boolean;
        readonly inputSelector: string;
        readonly receiptPath: string;
        readonly selection: Selection;
        readonly submitSelector?: string;
        readonly targetUrl: string;
        readonly testDataPath?: string;
      };
    }
  | { readonly message: string; readonly ok: false };

function parseOptions(
  arguments_: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
): OptionsResult {
  const parsed = parseFlags(arguments_, {
    "--all": "boolean",
    "--allow-authorized-data": "boolean",
    "--case": "value",
    "--cases": "value",
    "--category": "value",
    "--input-selector": "value",
    "--receipt": "value",
    "--submit-selector": "value",
    "--test-data": "value",
    "--url": "value",
  });
  if (!parsed.ok) return parsed;
  const caseId = parsed.values.get("--case");
  const category = parsed.values.get("--category");
  const all = parsed.values.has("--all");
  if (Number(all) + Number(caseId !== undefined) + Number(category !== undefined) !== 1) {
    return { ok: false, message: "Preflight selection requires exactly one of --all, --case <id>, or --category <category>." };
  }
  if (typeof category !== "undefined" && !isResearchCategory(category)) {
    return { ok: false, message: `Research category must be one of: ${RESEARCH_CATEGORIES.join(", ")}.` };
  }
  const targetUrl = parsed.values.get("--url") ?? environment.ASK_MAERSK_URL;
  if (typeof targetUrl === "undefined" || targetUrl.trim().length === 0) {
    return { ok: false, message: "ASK_MAERSK_URL is required. Set it in .env or pass --url <url>." };
  }
  const url = URL.parse(targetUrl);
  if (url === null || !["http:", "https:"].includes(url.protocol)) {
    return { ok: false, message: "Ask Maersk URL must be an http:// or https:// URL." };
  }
  const inputSelector = parsed.values.get("--input-selector") ?? environment.ASK_MAERSK_INPUT_SELECTOR;
  if (typeof inputSelector === "undefined" || inputSelector.trim().length === 0) {
    return { ok: false, message: "ASK_MAERSK_INPUT_SELECTOR is required for preflight." };
  }
  const selection: Selection = all
    ? { all: true }
    : typeof caseId !== "undefined"
      ? { caseId }
      : { category: category as ResearchCategory };
  const submitSelector = parsed.values.get("--submit-selector") ?? environment.ASK_MAERSK_SUBMIT_SELECTOR;
  const testDataPath = parsed.values.get("--test-data") ?? environment.RESEARCH_TEST_DATA_FILE;
  return {
    ok: true,
    options: {
      allowAuthorizedData: parsed.values.has("--allow-authorized-data"),
      casesDirectory: parsed.values.get("--cases") ?? environment.RESEARCH_CASES_DIR ?? join(process.cwd(), "cases"),
      inputSelector,
      receiptPath: parsed.values.get("--receipt") ?? environment.RESEARCH_PREFLIGHT_RECEIPT ?? join(process.cwd(), ".research", "preflight.json"),
      selection,
      targetUrl: url.toString(),
      ...(typeof testDataPath === "undefined" ? {} : { testDataPath }),
      ...(typeof submitSelector === "undefined" ? {} : { submitSelector }),
    },
  };
}

async function loadTestData(path: string | undefined): Promise<Readonly<Record<string, string>>> {
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

function selectCases(cases: readonly ResearchCase[], selection: Selection): readonly ResearchCase[] {
  if ("all" in selection) return cases;
  if ("caseId" in selection) {
    const selected = cases.find(({ id }) => id === selection.caseId);
    if (typeof selected === "undefined") throw new Error(`Research case "${selection.caseId}" was not found.`);
    return [selected];
  }
  return cases.filter(({ category }) => category === selection.category);
}

function isResearchCategory(value: string): value is ResearchCategory {
  return RESEARCH_CATEGORIES.some((category) => category === value);
}
