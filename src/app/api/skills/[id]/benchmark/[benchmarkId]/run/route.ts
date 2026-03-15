import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { readSkill, readBenchmark, writeRunResult, writeSkill } from "@/lib/store/fs-store";
import { callLLM } from "@/runtime/llm-client";
import { buildInstructionsFromSkill } from "@/runtime/instructions";
import type { BenchmarkCaseResult, BenchmarkRunResult } from "@/lib/types";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; benchmarkId: string }> },
) {
  const { id, benchmarkId } = await params;

  const skill = await readSkill(id);
  if (!skill) {
    return NextResponse.json({ error: "Skill not found" }, { status: 404 });
  }

  const benchmark = await readBenchmark(benchmarkId);
  if (!benchmark) {
    return NextResponse.json({ error: "Benchmark not found" }, { status: 404 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY not configured" },
      { status: 500 },
    );
  }

  if (benchmark.cases.length === 0) {
    return NextResponse.json(
      { error: "Benchmark has no eval cases" },
      { status: 400 },
    );
  }

  const instructions = buildInstructionsFromSkill(skill);
  const model = skill.model || "gpt-4o";
  const baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
  const runId = uuidv4();

  const results: BenchmarkCaseResult[] = [];

  for (const evalCase of benchmark.cases) {
    const start = Date.now();
    try {
      const response = await callLLM({
        model,
        baseUrl,
        apiKey,
        instructions,
        input: [{ role: "user", content: evalCase.input }],
        maxOutputTokens: 4096,
      });

      const wallClockMs = Date.now() - start;
      const passed = response.content
        .toLowerCase()
        .includes(evalCase.expected.toLowerCase());

      results.push({
        evalCaseId: evalCase.id,
        input: evalCase.input,
        expected: evalCase.expected,
        actual: response.content,
        passed,
        reasoning: response.reasoning,
        tokenUsage: response.tokenUsage,
        wallClockMs,
      });
    } catch (err) {
      const wallClockMs = Date.now() - start;
      results.push({
        evalCaseId: evalCase.id,
        input: evalCase.input,
        expected: evalCase.expected,
        actual: err instanceof Error ? err.message : String(err),
        passed: false,
        reasoning: null,
        tokenUsage: { input: 0, output: 0 },
        wallClockMs,
      });
    }
  }

  const passedCount = results.filter((r) => r.passed).length;
  const score = passedCount / results.length;
  const totalTokens = results.reduce(
    (sum, r) => sum + r.tokenUsage.input + r.tokenUsage.output + (r.tokenUsage.reasoning ?? 0),
    0,
  );
  const totalWallClockMs = results.reduce((sum, r) => sum + r.wallClockMs, 0);

  const runResult: BenchmarkRunResult = {
    runId,
    skillId: id,
    benchmarkId,
    timestamp: new Date().toISOString(),
    results,
    score,
    totalTokens,
    totalWallClockMs,
  };

  await writeRunResult(runResult);

  skill.score = score;
  await writeSkill(skill);

  return NextResponse.json(runResult);
}
