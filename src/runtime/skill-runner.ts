import { resolve } from "path";
import { buildSkillInstructions } from "./skill-loader";
import { callLLM } from "./llm-client";
import type { LLMInputItem } from "./llm-client";
import { runScript, formatRunResult } from "./script-executor";

const RUN_SCRIPT_TOOL = {
  type: "function" as const,
  name: "run_script",
  description:
    "Run a script from the skill's scripts directory. Use when the skill instructions or the user request require executing a script. Path is relative to the skill root (e.g. scripts/process.py).",
  parameters: {
    type: "object" as const,
    properties: {
      script_path: {
        type: "string" as const,
        description: "Path relative to the skill root, e.g. scripts/foo.py",
      },
      args: {
        type: "string" as const,
        description: "Optional arguments to pass to the script, e.g. '--input data.csv'",
      },
    },
    required: ["script_path" as const],
  },
};

export interface RunWithSkillAndToolsOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  maxOutputTokens?: number;
  maxToolRounds?: number;
  reasoning?: {
    effort?: "low" | "medium" | "high";
    summary?: "auto" | "concise" | "detailed";
  };
}

export interface RunWithSkillAndToolsResult {
  content: string;
  inputItems: LLMInputItem[];
  reasoning: string | null;
  tokenUsage: { input: number; output: number; reasoning?: number };
}

/**
 * Run the LLM with a skill (instructions) and user message via the Responses API,
 * executing run_script tool calls until the model returns a final answer.
 */
export async function runWithSkillAndTools(
  skillDirPath: string,
  userMessage: string,
  options: RunWithSkillAndToolsOptions
): Promise<RunWithSkillAndToolsResult> {
  const {
    apiKey,
    model = "gpt-4o",
    baseUrl = "https://api.openai.com/v1",
    maxOutputTokens = 4096,
    maxToolRounds = 10,
    reasoning,
  } = options;

  const skillRoot = resolve(skillDirPath);
  const instructions = await buildSkillInstructions(skillDirPath);

  const inputItems: LLMInputItem[] = [{ role: "user", content: userMessage }];
  let totalInput = 0;
  let totalOutput = 0;
  let totalReasoning = 0;
  const reasoningLogs: string[] = [];
  let lastContent = "";
  let rounds = 0;

  while (rounds < maxToolRounds) {
    rounds++;
    const response = await callLLM({
      model,
      baseUrl,
      apiKey,
      instructions,
      input: inputItems,
      maxOutputTokens,
      tools: [RUN_SCRIPT_TOOL],
      toolChoice: "auto",
      reasoning,
    });

    totalInput += response.tokenUsage.input;
    totalOutput += response.tokenUsage.output;
    if (typeof response.tokenUsage.reasoning === "number") {
      totalReasoning += response.tokenUsage.reasoning;
    }
    if (response.reasoning) {
      reasoningLogs.push(response.reasoning);
    }
    if (response.content) {
      lastContent = response.content;
    }

    if (!response.toolCalls || response.toolCalls.length === 0) {
      return {
        content: response.content,
        inputItems,
        reasoning: reasoningLogs.length > 0 ? reasoningLogs.join("\n\n") : null,
        tokenUsage: {
          input: totalInput,
          output: totalOutput,
          ...(totalReasoning > 0 && { reasoning: totalReasoning }),
        },
      };
    }

    // Pass all output items back (reasoning + function_call items) for context continuity
    inputItems.push(...response.outputItems);

    for (const tc of response.toolCalls) {
      if (tc.name !== "run_script") {
        inputItems.push({
          type: "function_call_output",
          call_id: tc.callId,
          output: `Error: unknown tool "${tc.name}"`,
        });
        continue;
      }
      let args: { script_path: string; args?: string };
      try {
        args = JSON.parse(tc.arguments) as { script_path: string; args?: string };
      } catch {
        inputItems.push({
          type: "function_call_output",
          call_id: tc.callId,
          output: `Error: invalid arguments JSON: ${tc.arguments}`,
        });
        continue;
      }
      const { script_path, args: argsStr } = args;
      try {
        const result = await runScript(skillRoot, script_path, argsStr);
        const output = formatRunResult(result);
        inputItems.push({ type: "function_call_output", call_id: tc.callId, output });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        inputItems.push({
          type: "function_call_output",
          call_id: tc.callId,
          output: `Error: ${msg}`,
        });
      }
    }
  }

  return {
    content: lastContent || "[Stopped after max tool rounds]",
    inputItems,
    reasoning: reasoningLogs.length > 0 ? reasoningLogs.join("\n\n") : null,
    tokenUsage: {
      input: totalInput,
      output: totalOutput,
      ...(totalReasoning > 0 && { reasoning: totalReasoning }),
    },
  };
}
