import type { Skill, PyBenchmarkReport } from "@/lib/types";
import { writeSkill } from "@/lib/store/fs-store";

interface SelectionResult {
  winnerId: string;
  winnerScore: number;
  prunedIds: string[];
}

export async function selectWinner(
  variantSkills: Skill[],
  benchmarkResults: Record<string, PyBenchmarkReport[]>,
  targetCategory: string,
): Promise<SelectionResult> {
  if (variantSkills.length === 0) {
    throw new Error("No variants to select from");
  }

  // Score each variant on the target category
  const scored: Array<{ skill: Skill; categoryScore: number }> = [];

  for (const skill of variantSkills) {
    const reports = benchmarkResults[skill.id] || [];
    if (reports.length === 0) {
      scored.push({ skill, categoryScore: 0 });
      continue;
    }

    // Average the target category score across all test inputs
    let totalScore = 0;
    let count = 0;
    for (const report of reports) {
      const cat = report.categories[targetCategory];
      if (cat) {
        totalScore += cat.score;
        count++;
      }
    }
    const avgScore = count > 0 ? totalScore / count : 0;
    scored.push({ skill, categoryScore: avgScore });
  }

  // Sort by target category score descending
  scored.sort((a, b) => b.categoryScore - a.categoryScore);

  const winner = scored[0];
  const losers = scored.slice(1);

  // Update winner score (overall composite across all categories)
  const winnerReports = benchmarkResults[winner.skill.id] || [];
  if (winnerReports.length > 0) {
    const overallAvg =
      winnerReports.reduce((sum, r) => sum + r.overall.score, 0) /
      winnerReports.length;
    winner.skill.score = overallAvg;
    winner.skill.status = "active";
    await writeSkill(winner.skill);
  }

  // Mark losers as pruned
  const prunedIds: string[] = [];
  for (const loser of losers) {
    loser.skill.status = "pruned";
    // Also set their score for display
    const loserReports = benchmarkResults[loser.skill.id] || [];
    if (loserReports.length > 0) {
      loser.skill.score =
        loserReports.reduce((sum, r) => sum + r.overall.score, 0) /
        loserReports.length;
    }
    await writeSkill(loser.skill);
    prunedIds.push(loser.skill.id);
  }

  return {
    winnerId: winner.skill.id,
    winnerScore: winner.categoryScore,
    prunedIds,
  };
}
