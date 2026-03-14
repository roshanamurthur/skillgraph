export interface TraceTurn {
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  toolCalls?: Array<{ toolName: string; input: unknown; output: unknown }>;
  tokenUsage?: { input: number; output: number; reasoning?: number };
  timestampMs: number;
}

export interface Trace {
  traceId: string;
  runId: string;
  skillId: string;
  evalCaseId: string;
  turns: TraceTurn[];
  outcome: "success" | "failure" | "error";
  metrics: {
    totalTurns: number;
    wallClockMs: number;
    totalTokens: number;
    toolCallCount: number;
    estimatedCostUsd: number;
  };
}
