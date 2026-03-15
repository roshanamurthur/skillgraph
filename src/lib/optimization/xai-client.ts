import { callLLM, type LLMTool, type LLMInputItem } from "@/runtime/llm-client";

const XAI_BASE_URL = "https://api.x.ai/v1";
const XAI_MODEL = "grok-4.20-beta-0309-reasoning";

export interface MasterLLMRequest {
  instructions: string;
  input: LLMInputItem[];
  tools?: LLMTool[];
  toolChoice?: "auto" | "none" | "required";
  temperature?: number;
  maxOutputTokens?: number;
}

export async function callMasterLLM(request: MasterLLMRequest) {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    throw new Error("XAI_API_KEY environment variable is not set");
  }

  return callLLM({
    model: XAI_MODEL,
    baseUrl: XAI_BASE_URL,
    apiKey,
    instructions: request.instructions,
    input: request.input,
    tools: request.tools,
    toolChoice: request.toolChoice,
    temperature: request.temperature ?? 0.3,
    maxOutputTokens: request.maxOutputTokens ?? 8192,
  });
}
