export const RESEARCH_CATEGORIES = [
  "CAPABILITY",
  "TRACKING",
  "SCHEDULE",
  "KNOWLEDGE",
  "CONTEXT",
  "AUTH",
  "GUARDRAIL",
] as const;

export type ResearchCategory = (typeof RESEARCH_CATEGORIES)[number];
export type ResearchExecutionMode = "automated" | "manual";
export type ResearchDataPolicy = "authorized" | "fake" | "public";

export interface ResearchMessage {
  readonly text: string;
}

export interface ResearchCase {
  readonly id: string;
  readonly category: ResearchCategory;
  readonly objective: string;
  readonly authenticated: boolean;
  readonly dataPolicy: ResearchDataPolicy;
  readonly executionMode: ResearchExecutionMode;
  readonly messages: readonly ResearchMessage[];
  readonly testDataPlaceholders?: readonly string[];
  readonly captureTrace: boolean;
  readonly notes?: string;
}
