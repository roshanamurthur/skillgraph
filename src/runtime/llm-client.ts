/**
 * Input item for the OpenAI Responses API.
 * Can be a role-based message, a function_call_output, or a pass-through
 * output item (reasoning, function_call, message) from a previous response.
 */
export type LLMInputItem = Record<string, unknown>;

/** Responses API function tool definition. */
export interface LLMTool {
  type: "function";
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties?: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
}

export interface LLMRequest {
  model: string;
  baseUrl: string;
  apiKey: string;
  instructions?: string;
  input: LLMInputItem[];
  temperature?: number;
  maxOutputTokens?: number;
  tools?: LLMTool[];
  toolChoice?: "auto" | "none" | "required";
  reasoning?: {
    effort?: "low" | "medium" | "high";
    summary?: "auto" | "concise" | "detailed";
  };
}

export interface LLMResponse {
  content: string;
  reasoning: string | null;
  tokenUsage: {
    input: number;
    output: number;
    reasoning?: number;
  };
  /** Raw output items from the Responses API; pass these back in subsequent input for multi-turn. */
  outputItems: LLMInputItem[];
  rawResponse: unknown;
  toolCalls?: Array<{
    id: string;
    callId: string;
    name: string;
    arguments: string;
  }>;
}

interface ResponsesOutputItem {
  type: string;
  id?: string;
  role?: string;
  status?: string;
  content?: Array<{ type: string; text?: string; annotations?: unknown[] }>;
  call_id?: string;
  name?: string;
  arguments?: string;
  summary?: Array<{ type: string; text?: string }>;
}

interface ResponsesAPIResponse {
  id?: string;
  status?: string;
  output?: ResponsesOutputItem[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    output_tokens_details?: { reasoning_tokens?: number };
    total_tokens?: number;
  };
  error?: { message?: string };
  incomplete_details?: { reason?: string } | null;
}

function buildRequestBody(request: LLMRequest, omitSummary = false): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model,
    input: request.input,
  };
  if (request.instructions) {
    body.instructions = request.instructions;
  }
  if (request.maxOutputTokens != null) {
    body.max_output_tokens = request.maxOutputTokens;
  }
  if (request.temperature != null) {
    body.temperature = request.temperature;
  }
  if (request.tools && request.tools.length > 0) {
    body.tools = request.tools;
    body.tool_choice = request.toolChoice ?? "auto";
  }
  if (request.reasoning) {
    const reasoning = omitSummary
      ? { ...request.reasoning, summary: undefined }
      : request.reasoning;
    body.reasoning = reasoning;
  }
  return body;
}

async function sendRequest(
  url: string,
  apiKey: string,
  body: Record<string, unknown>
): Promise<{ ok: boolean; status: number; statusText: string; text: string }> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status, statusText: res.statusText, text: await res.text() };
}

export async function callLLM(request: LLMRequest): Promise<LLMResponse> {
  const url = `${request.baseUrl.replace(/\/$/, "")}/responses`;

  let body = buildRequestBody(request);
  let res = await sendRequest(url, request.apiKey, body);

  // If reasoning param was rejected, retry without it
  if (!res.ok && res.status === 400 && request.reasoning) {
    try {
      const errJson = JSON.parse(res.text) as ResponsesAPIResponse;
      const msg = errJson.error?.message ?? "";
      if (msg.includes("verified")) {
        // Org not verified for summaries — retry without summary
        console.warn("Reasoning summaries require org verification — retrying without summary.");
        body = buildRequestBody(request, true);
        res = await sendRequest(url, request.apiKey, body);
      } else if (msg.includes("reasoning") || msg.includes("not supported")) {
        // Model doesn't support reasoning at all — retry without it
        console.warn(`Model ${request.model} does not support reasoning — retrying without it.`);
        body = buildRequestBody({ ...request, reasoning: undefined });
        res = await sendRequest(url, request.apiKey, body);
      }
    } catch {
      // fall through to normal error handling
    }
  }

  if (!res.ok) {
    const hint = res.status === 429 ? " (rate limit)" : "";
    let errMsg = `LLM request failed${hint}: ${res.status} ${res.statusText}`;
    try {
      const errJson = JSON.parse(res.text) as ResponsesAPIResponse;
      if (errJson.error?.message) errMsg += `\n${errJson.error.message}`;
      else errMsg += `\n${res.text}`;
    } catch {
      errMsg += `\n${res.text.slice(0, 500)}`;
    }
    throw new Error(errMsg);
  }

  let data: ResponsesAPIResponse;
  try {
    data = JSON.parse(res.text) as ResponsesAPIResponse;
  } catch {
    throw new Error(`LLM response was not valid JSON: ${res.text.slice(0, 200)}`);
  }

  const output = data.output ?? [];

  let content = "";
  for (const item of output) {
    if (item.type === "message" && item.content) {
      for (const part of item.content) {
        if (part.type === "output_text" && part.text) {
          content += part.text;
        }
      }
    }
  }

  const reasoningSummaries: string[] = [];
  for (const item of output) {
    if (item.type === "reasoning" && item.summary) {
      for (const s of item.summary) {
        if (s.type === "summary_text" && s.text) {
          reasoningSummaries.push(s.text);
        }
      }
    }
  }

  const toolCalls: LLMResponse["toolCalls"] = [];
  for (const item of output) {
    if (
      item.type === "function_call" &&
      item.call_id &&
      item.name &&
      item.arguments != null
    ) {
      toolCalls.push({
        id: item.id ?? item.call_id,
        callId: item.call_id,
        name: item.name,
        arguments: item.arguments,
      });
    }
  }

  const usage = data.usage;
  const inputTokens = usage?.input_tokens ?? 0;
  const outputTokens = usage?.output_tokens ?? 0;
  const reasoningTokens = usage?.output_tokens_details?.reasoning_tokens;

  if (data.status === "incomplete" && data.incomplete_details?.reason) {
    console.warn(`Response incomplete: ${data.incomplete_details.reason}`);
  }

  return {
    content,
    reasoning:
      reasoningSummaries.length > 0
        ? reasoningSummaries.join("\n\n")
        : null,
    tokenUsage: {
      input: inputTokens,
      output: outputTokens,
      ...(typeof reasoningTokens === "number" &&
        reasoningTokens >= 0 && { reasoning: reasoningTokens }),
    },
    outputItems: output as unknown as LLMInputItem[],
    rawResponse: data,
    ...(toolCalls.length > 0 && { toolCalls }),
  };
}
