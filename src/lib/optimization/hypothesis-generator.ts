import { randomUUID } from "crypto";
import type { PyBenchmarkReport } from "@/lib/types";
import type { RankedError, Hypothesis } from "./types";
import { callMasterLLM } from "./xai-client";

function buildHypothesisPrompt(
  skillContent: string,
  error: RankedError,
  reports: PyBenchmarkReport[],
): string {
  const sections: string[] = [];

  sections.push("# Current Skill Content\n");
  sections.push(skillContent);

  sections.push(`\n\n# Error to Address: ${error.categoryLabel}`);
  sections.push(`Score: ${Math.round(error.score * 100)}% (${error.failedCount} of ${error.totalCount} checks failed)`);
  sections.push(`Importance: ${error.importancePercentage.toFixed(1)}%`);
  sections.push(`Ranking reasoning: ${error.reasoning}`);

  if (error.failurePatterns.length > 0) {
    sections.push("\nIdentified failure patterns:");
    for (const p of error.failurePatterns) {
      sections.push(`  - ${p}`);
    }
  }

  sections.push("\n\n# Failed Checks for This Category Across All Test Inputs\n");

  for (const report of reports) {
    const cat = report.categories[error.category];
    if (!cat || cat.failed_checks.length === 0) continue;

    sections.push(`\n## Test Input: ${report.test_input}`);
    for (const fc of cat.failed_checks) {
      sections.push(`- ${fc.check}: actual=${fc.actual}, expected=${fc.expected}, delta=${fc.delta}`);
      if (fc.description) {
        sections.push(`  Hint: ${fc.description}`);
      }
      if (fc.cell) {
        sections.push(`  Location: ${fc.cell}`);
      }
    }

    if (report.reasoning_trace) {
      sections.push("\n### Execution Trace (relevant sections):");
      sections.push(report.reasoning_trace.slice(0, 3000));
    }
  }

  return sections.join("\n");
}

const SYSTEM_PROMPT = `You are an expert skill optimization analyst. You are given an LLM skill (a markdown instruction document) that tells an AI agent how to generate Excel workbooks with student grade statistics.

The benchmark has identified specific failures in a category. Your job is to:

1. Read the skill content carefully — understand every formula, boundary, and instruction it specifies.
2. Read the failed checks — look at the actual vs expected values, deltas, and diagnostic hints.
3. Read the execution trace — see what decisions the agent actually made when following the skill.
4. Identify the ROOT CAUSE in the skill instructions — what specific text, formula, or instruction led the agent astray.
5. Generate up to 5 hypotheses, each proposing a SPECIFIC change to the skill text.

Each hypothesis must include:
- A clear description of what's wrong
- The root cause (the specific part of the skill that's incorrect or ambiguous)
- The EXACT proposed change: what text in the skill should be replaced with what

Focus on the skill INSTRUCTIONS, not the agent's behavior. The goal is to improve the skill so that ANY agent following it would produce correct results.

You MUST call the submit_hypotheses tool with your analysis.`;

const HYPOTHESES_TOOL = {
  type: "function" as const,
  name: "submit_hypotheses",
  description: "Submit hypotheses for fixing the identified error",
  parameters: {
    type: "object" as const,
    properties: {
      hypotheses: {
        type: "array",
        description: "Up to 5 hypotheses, ordered by confidence",
        items: {
          type: "object",
          properties: {
            description: { type: "string", description: "What aspect of the skill is wrong" },
            root_cause: { type: "string", description: "The specific text/section in the skill that caused this error" },
            proposed_change: { type: "string", description: "The exact modification to make to the skill. Format: 'REPLACE: [old text] WITH: [new text]'" },
            confidence: { type: "number", description: "Confidence that this fix will resolve the issue (0-1)" },
          },
          required: ["description", "root_cause", "proposed_change", "confidence"],
        },
      },
    },
    required: ["hypotheses"],
  },
};

export async function generateHypotheses(
  skillContent: string,
  parentSkillId: string,
  error: RankedError,
  reports: PyBenchmarkReport[],
): Promise<Hypothesis[]> {
  const prompt = buildHypothesisPrompt(skillContent, error, reports);

  const response = await callMasterLLM({
    instructions: SYSTEM_PROMPT,
    input: [{ role: "user", content: prompt }],
    tools: [HYPOTHESES_TOOL],
    toolChoice: "required",
    maxOutputTokens: 8192,
  });

  if (!response.toolCalls || response.toolCalls.length === 0) {
    throw new Error("Master LLM did not return hypotheses tool call");
  }

  const args = JSON.parse(response.toolCalls[0].arguments);
  return (args.hypotheses as Array<Record<string, unknown>>)
    .slice(0, 5)
    .map((h) => ({
      id: randomUUID(),
      parentSkillId,
      targetCategory: error.category,
      description: h.description as string,
      rootCause: h.root_cause as string,
      proposedChange: h.proposed_change as string,
      confidence: h.confidence as number,
    }));
}
