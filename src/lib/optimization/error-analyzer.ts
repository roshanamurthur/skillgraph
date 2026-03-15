import type { PyBenchmarkReport } from "@/lib/types";
import type { RankedError } from "./types";
import { callMasterLLM } from "./xai-client";

const CATEGORY_LABELS: Record<string, string> = {
  student_calculations: "Student Calculations",
  assessment_stats: "Assessment Stats",
  overall_stats: "Overall Stats",
  advanced_metrics: "Advanced Metrics",
  boundary_cases: "Boundary Cases",
};

function buildErrorAnalysisPrompt(
  skillContent: string,
  reports: PyBenchmarkReport[],
): string {
  const sections: string[] = [];

  sections.push("# Skill Content\n");
  sections.push(skillContent);
  sections.push("\n\n# Benchmark Results Across All Test Inputs\n");

  for (const report of reports) {
    sections.push(`\n## Test Input: ${report.test_input}`);
    sections.push(`Overall: ${report.overall.fraction} (${Math.round(report.overall.score * 100)}%)\n`);

    for (const [catName, cat] of Object.entries(report.categories)) {
      const label = CATEGORY_LABELS[catName] || catName;
      sections.push(`### ${label}: ${cat.fraction} (${Math.round(cat.score * 100)}%)`);

      if (cat.failed_checks.length > 0) {
        sections.push(`Failed checks (${cat.failed_checks.length}):`);
        for (const fc of cat.failed_checks) {
          sections.push(`  - ${fc.check}: actual=${fc.actual}, expected=${fc.expected}, delta=${fc.delta}`);
          if (fc.description) {
            sections.push(`    ${fc.description}`);
          }
          if (fc.cell) {
            sections.push(`    Location: ${fc.cell} (${fc.sheet}, row ${fc.row}, col ${fc.column_letter})`);
          }
        }
      }
    }

    if (report.failures_by_location && Object.keys(report.failures_by_location).length > 0) {
      sections.push("\n### Failures Grouped by Location:");
      for (const [sheet, rows] of Object.entries(report.failures_by_location)) {
        sections.push(`  Sheet: ${sheet}`);
        for (const [rowKey, errors] of Object.entries(rows)) {
          sections.push(`    ${rowKey}: ${(errors as string[]).join("; ")}`);
        }
      }
    }

    if (report.reasoning_trace) {
      sections.push("\n### Execution Trace (Agent Reasoning):");
      sections.push(report.reasoning_trace.slice(0, 4000));
    }
  }

  return sections.join("\n");
}

const SYSTEM_PROMPT = `You are an expert skill optimization analyst. You analyze benchmark results from an LLM skill that generates Excel workbooks with student grade statistics.

Your task is to rank error categories by importance. Consider:
1. How low the score is (lower = more important to fix)
2. How many individual checks failed (more failures = more impactful)
3. Dependency chains — some errors cascade into others. For example:
   - If weighted_average is wrong, letter_grade, rank, above_class_average, percentile, and z_score will also be wrong
   - If std_dev is wrong, z_score and most_consistent_student will be wrong
   - If slope is wrong, most_improved_student will be wrong
   - Fixing a root cause in one category may automatically fix failures in other categories
4. Common failure patterns — if many checks fail with the same delta or same type of error, it's likely one root cause

You MUST call the report_error_ranking tool with your analysis.`;

const RANKING_TOOL = {
  type: "function" as const,
  name: "report_error_ranking",
  description: "Report the ranked list of errors by importance",
  parameters: {
    type: "object" as const,
    properties: {
      ranked_errors: {
        type: "array",
        description: "Errors ranked from most to least important",
        items: {
          type: "object",
          properties: {
            category: { type: "string", description: "Category key (e.g., advanced_metrics)" },
            category_label: { type: "string", description: "Human-readable label" },
            score: { type: "number", description: "Average category score across test inputs (0-1)" },
            failed_count: { type: "number", description: "Total failed checks across all test inputs" },
            total_count: { type: "number", description: "Total checks across all test inputs" },
            importance_score: { type: "number", description: "Computed importance (0-100)" },
            importance_percentage: { type: "number", description: "Share of total importance (0-100)" },
            reasoning: { type: "string", description: "Why this error is ranked at this position" },
            failure_patterns: {
              type: "array",
              description: "Identified patterns in the failures",
              items: { type: "string" },
            },
          },
          required: ["category", "category_label", "score", "failed_count", "total_count", "importance_score", "importance_percentage", "reasoning", "failure_patterns"],
        },
      },
    },
    required: ["ranked_errors"],
  },
};

export async function analyzeErrors(
  skillContent: string,
  reports: PyBenchmarkReport[],
): Promise<RankedError[]> {
  const prompt = buildErrorAnalysisPrompt(skillContent, reports);

  const response = await callMasterLLM({
    instructions: SYSTEM_PROMPT,
    input: [{ role: "user", content: prompt }],
    tools: [RANKING_TOOL],
    toolChoice: "required",
  });

  if (!response.toolCalls || response.toolCalls.length === 0) {
    throw new Error("Master LLM did not return error ranking tool call");
  }

  const args = JSON.parse(response.toolCalls[0].arguments);
  const rankedErrors: RankedError[] = args.ranked_errors.map(
    (e: Record<string, unknown>) => ({
      category: e.category as string,
      categoryLabel: e.category_label as string,
      score: e.score as number,
      failedCount: e.failed_count as number,
      totalCount: e.total_count as number,
      importanceScore: e.importance_score as number,
      importancePercentage: e.importance_percentage as number,
      reasoning: e.reasoning as string,
      failurePatterns: e.failure_patterns as string[],
    }),
  );

  // Filter out categories with perfect scores
  return rankedErrors.filter((e) => e.failedCount > 0);
}
