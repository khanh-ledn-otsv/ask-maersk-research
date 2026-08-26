import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import {
  findingClaimsSchema,
  type AnalysisRequest,
  type AnalysisUsage,
  type Analyzer,
  type AnalyzerResponse,
} from "./analyze-evidence.ts";

const ANALYSIS_INSTRUCTIONS = `You analyze captured Ask Maersk research evidence.
Return exactly one structured finding for the supplied run.
Classify only observed behavior. Treat API candidates as plausible inferences, never confirmed facts.
Every behavior claim, API rationale, and Ask ONE implication must cite one or more exact evidence references from the supplied run.
Use only these reference forms: page:page, conversation:<index>, screenshot:<path>, network:<id>, timing:<turnIndex>, error:<zero-based-index>.
Do not invent, repair, or cite a reference that is absent from the supplied evidence.
If evidence is insufficient, use the unknown classification, low confidence, or omit an API candidate instead of guessing.`;

export function createOpenAIEvidenceAnalyzer(apiKey: string): Analyzer {
  const client = new OpenAI({ apiKey });
  return {
    async analyze(request): Promise<AnalyzerResponse> {
      try {
        const response = await client.responses.parse({
          model: request.model,
          instructions: ANALYSIS_INSTRUCTIONS,
          input: buildAnalysisInput(request),
          max_output_tokens: 4_000,
          reasoning: { effort: request.reasoningEffort },
          store: false,
          text: {
            format: zodTextFormat(findingClaimsSchema, "ask_maersk_finding"),
            verbosity: "low",
          },
        });
        return {
          model: response.model,
          output: response.output_parsed,
          ...(typeof response.usage === "undefined"
            ? {}
            : {
                usage: mapUsage(response.usage),
              }),
        };
      } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`OpenAI request failed: ${detail}`, { cause: error });
      }
    },
  };
}

function buildAnalysisInput(request: AnalysisRequest): string {
  return JSON.stringify(
    {
      sourceRunId: request.evidence.runId,
      evidenceReferenceCatalog: {
        page: ["page"],
        conversation: request.evidence.conversation.map(({ index }) => String(index)),
        screenshot: request.evidence.screenshots.map(({ path }) => path),
        network: request.evidence.network.map(({ id }) => id),
        timing: request.evidence.timings.map(({ turnIndex }) => String(turnIndex)),
        error: request.evidence.errors.map((_, index) => String(index)),
      },
      evidence: request.evidence,
    },
    null,
    2,
  );
}

function mapUsage(usage: {
  readonly input_tokens: number;
  readonly input_tokens_details: { readonly cached_tokens: number };
  readonly output_tokens: number;
  readonly output_tokens_details: { readonly reasoning_tokens: number };
}): AnalysisUsage {
  return {
    inputTokens: usage.input_tokens,
    cachedInputTokens: usage.input_tokens_details.cached_tokens,
    outputTokens: usage.output_tokens,
    reasoningTokens: usage.output_tokens_details.reasoning_tokens,
  };
}
