import { createHash } from "node:crypto";
import type { ResearchCase } from "../domain/research-case.ts";

export interface PreflightConfiguration {
  readonly allowAuthorizedData: boolean;
  readonly cases: readonly ResearchCase[];
  readonly inputSelector?: string;
  readonly selection: unknown;
  readonly submitSelector?: string;
  readonly targetUrl: string;
  readonly testData: Readonly<Record<string, string>>;
}

export function createPreflightFingerprint(configuration: PreflightConfiguration): string {
  const testData = Object.fromEntries(Object.entries(configuration.testData).toSorted());
  return createHash("sha256")
    .update(JSON.stringify({ ...configuration, testData }))
    .digest("hex");
}
