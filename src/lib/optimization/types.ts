import type { PyBenchmarkReport } from "@/lib/types";

// --- Error ranking ---

export interface RankedError {
  category: string;
  categoryLabel: string;
  score: number;
  failedCount: number;
  totalCount: number;
  importanceScore: number;
  importancePercentage: number;
  reasoning: string;
  failurePatterns: string[];
}

// --- Hypothesis ---

export interface Hypothesis {
  id: string;
  parentSkillId: string;
  targetCategory: string;
  description: string;
  rootCause: string;
  proposedChange: string;
  confidence: number;
}

// --- Optimization run tracking ---

export interface OptimizationRun {
  id: string;
  rootSkillId: string;
  status: "running" | "completed" | "failed";
  rankedErrors: RankedError[];
  iterations: OptimizationIteration[];
  currentIterationIndex: number;
  bestSkillId: string | null;
  startedAt: string;
  completedAt: string | null;
}

export interface OptimizationIteration {
  category: string;
  hypotheses: Hypothesis[];
  variantSkillIds: string[];
  benchmarkResults: Record<string, PyBenchmarkReport[]>;
  winnerId: string | null;
  winnerScore: number | null;
  prunedIds: string[];
}

// --- SSE events ---

export type OptimizationEvent =
  | { type: "started"; runId: string }
  | { type: "benchmark_running"; skillId: string }
  | { type: "benchmark_complete"; skillId: string; score: number }
  | { type: "errors_ranked"; errors: RankedError[] }
  | { type: "generating_hypotheses"; category: string }
  | { type: "hypotheses_generated"; hypotheses: Hypothesis[] }
  | { type: "variant_created"; skillId: string; hypothesis: Hypothesis }
  | { type: "variant_benchmarking"; skillId: string }
  | {
      type: "variant_benchmark_complete";
      skillId: string;
      score: number;
    }
  | {
      type: "iteration_complete";
      category: string;
      winnerId: string;
      prunedIds: string[];
    }
  | { type: "completed"; bestSkillId: string; bestScore: number }
  | { type: "error"; message: string };
