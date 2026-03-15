import { spawn } from "child_process";
import { randomUUID } from "crypto";
import type { Skill, PyBenchmarkReport } from "@/lib/types";
import type {
  OptimizationEvent,
  OptimizationRun,
  RankedError,
  Hypothesis,
} from "./types";
import { readSkill, readPyBenchmarkReports, syncSkillFile } from "@/lib/store/fs-store";
import { analyzeErrors } from "./error-analyzer";
import { generateHypotheses } from "./hypothesis-generator";
import { generateVariant } from "./variant-generator";
import { selectWinner } from "./selector";

function getSkillContent(skill: Skill): string {
  const mdFile = skill.files.find(
    (f) => f.name.endsWith(".md") || f.name.endsWith(".skill"),
  );
  return mdFile?.parsed?.body || mdFile?.content || skill.prompt || "";
}

/**
 * Run the Python benchmark for a given version.
 * Spawns `python3 benchmark/run_benchmark.py --version <version>` and waits for completion.
 */
function runPyBenchmark(version: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "python3",
      ["benchmark/run_benchmark.py", "--version", version],
      { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] },
    );

    let stderr = "";
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Benchmark failed (exit ${code}): ${stderr.slice(-500)}`));
    });

    proc.on("error", (err) => reject(err));
  });
}

/**
 * Run benchmarks for multiple skill variants in parallel.
 * Each variant must already have its .md file synced to /skill/.
 */
async function runBenchmarksInParallel(
  variants: Skill[],
): Promise<Record<string, PyBenchmarkReport[]>> {
  // Run all benchmarks concurrently
  await Promise.all(
    variants.map((skill) => {
      const version = `v${skill.version}`;
      return runPyBenchmark(version);
    }),
  );

  // Collect results
  const results: Record<string, PyBenchmarkReport[]> = {};
  for (const skill of variants) {
    const version = `v${skill.version}`;
    results[skill.id] = await readPyBenchmarkReports(version);
  }
  return results;
}

export async function* runOptimization(
  rootSkillId: string,
): AsyncGenerator<OptimizationEvent> {
  const runId = randomUUID();
  yield { type: "started", runId };

  // 1. Load root skill
  const rootSkill = await readSkill(rootSkillId);
  if (!rootSkill) {
    yield { type: "error", message: `Skill ${rootSkillId} not found` };
    return;
  }

  const skillContent = getSkillContent(rootSkill);
  if (!skillContent.trim()) {
    yield { type: "error", message: "Skill has no content (.md file)" };
    return;
  }

  // 2. Sync skill file and run benchmark on root skill
  yield { type: "benchmark_running", skillId: rootSkillId };
  try {
    await syncSkillFile(rootSkill);
    const version = `v${rootSkill.version}`;
    await runPyBenchmark(version);
    const rootReports = await readPyBenchmarkReports(version);

    if (rootReports.length === 0) {
      yield { type: "error", message: "No benchmark results produced for root skill" };
      return;
    }

    const rootScore =
      rootReports.reduce((sum, r) => sum + r.overall.score, 0) / rootReports.length;
    yield { type: "benchmark_complete", skillId: rootSkillId, score: rootScore };

    // 3. Analyze errors
    let rankedErrors: RankedError[];
    try {
      rankedErrors = await analyzeErrors(skillContent, rootReports);
    } catch (err) {
      yield {
        type: "error",
        message: `Error analysis failed: ${err instanceof Error ? err.message : String(err)}`,
      };
      return;
    }

    if (rankedErrors.length === 0) {
      yield { type: "completed", bestSkillId: rootSkillId, bestScore: rootScore };
      return;
    }

    yield { type: "errors_ranked", errors: rankedErrors };

    // 4. Iterate through errors by importance
    let currentSkill = rootSkill;
    let currentReports = rootReports;

    const optimizationRun: OptimizationRun = {
      id: runId,
      rootSkillId,
      status: "running",
      rankedErrors,
      iterations: [],
      currentIterationIndex: 0,
      bestSkillId: rootSkillId,
      startedAt: new Date().toISOString(),
      completedAt: null,
    };

    for (let i = 0; i < rankedErrors.length; i++) {
      const error = rankedErrors[i];
      optimizationRun.currentIterationIndex = i;

      yield { type: "generating_hypotheses", category: error.category };

      // 4a. Generate hypotheses
      let hypotheses: Hypothesis[];
      try {
        hypotheses = await generateHypotheses(
          getSkillContent(currentSkill),
          currentSkill.id,
          error,
          currentReports,
        );
      } catch (err) {
        yield {
          type: "error",
          message: `Hypothesis generation failed for ${error.categoryLabel}: ${err instanceof Error ? err.message : String(err)}`,
        };
        continue;
      }

      if (hypotheses.length === 0) {
        continue;
      }

      yield { type: "hypotheses_generated", hypotheses };

      // 4b. Create variant nodes
      const variants: Skill[] = [];
      for (const hypothesis of hypotheses) {
        try {
          const variant = await generateVariant(currentSkill, hypothesis);
          variants.push(variant);
          yield { type: "variant_created", skillId: variant.id, hypothesis };
        } catch (err) {
          yield {
            type: "error",
            message: `Variant generation failed: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      }

      if (variants.length === 0) {
        continue;
      }

      // 4c. Run benchmarks in parallel
      for (const v of variants) {
        yield { type: "variant_benchmarking", skillId: v.id };
      }

      let benchmarkResults: Record<string, PyBenchmarkReport[]>;
      try {
        benchmarkResults = await runBenchmarksInParallel(variants);
      } catch (err) {
        yield {
          type: "error",
          message: `Benchmark run failed: ${err instanceof Error ? err.message : String(err)}`,
        };
        continue;
      }

      for (const v of variants) {
        const reports = benchmarkResults[v.id] || [];
        const score =
          reports.length > 0
            ? reports.reduce((sum, r) => sum + r.overall.score, 0) / reports.length
            : 0;
        yield { type: "variant_benchmark_complete", skillId: v.id, score };
      }

      // 4d. Select winner
      try {
        const selection = await selectWinner(
          variants,
          benchmarkResults,
          error.category,
        );

        yield {
          type: "iteration_complete",
          category: error.category,
          winnerId: selection.winnerId,
          prunedIds: selection.prunedIds,
        };

        // 4e. Winner becomes current for next iteration
        const winnerSkill = await readSkill(selection.winnerId);
        if (winnerSkill) {
          currentSkill = winnerSkill;
          currentReports = benchmarkResults[selection.winnerId] || [];
          optimizationRun.bestSkillId = selection.winnerId;
        }

        optimizationRun.iterations.push({
          category: error.category,
          hypotheses,
          variantSkillIds: variants.map((v) => v.id),
          benchmarkResults,
          winnerId: selection.winnerId,
          winnerScore: selection.winnerScore,
          prunedIds: selection.prunedIds,
        });
      } catch (err) {
        yield {
          type: "error",
          message: `Selection failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    // 5. Done
    const finalReports = currentReports;
    const finalScore =
      finalReports.length > 0
        ? finalReports.reduce((sum, r) => sum + r.overall.score, 0) / finalReports.length
        : 0;

    optimizationRun.status = "completed";
    optimizationRun.completedAt = new Date().toISOString();

    yield {
      type: "completed",
      bestSkillId: optimizationRun.bestSkillId || rootSkillId,
      bestScore: finalScore,
    };
  } catch (err) {
    yield {
      type: "error",
      message: `Optimization failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
