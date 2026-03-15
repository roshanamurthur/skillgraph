import type { Skill, DeleteResult, RunTraceResult, Benchmark, BenchmarkRunResult, PyBenchmarkReport, PyBenchmarkRunStatus } from "@/lib/types";

export async function fetchAllSkills(): Promise<Skill[]> {
  const res = await fetch("/api/skills");
  if (!res.ok) throw new Error("Failed to fetch skills");
  return res.json();
}

export async function saveSkillToServer(skill: Skill): Promise<void> {
  const res = await fetch("/api/skills", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(skill),
  });
  if (!res.ok) throw new Error("Failed to save skill");
}

export async function deleteSkillFromServer(
  id: string,
  prune: "subtree" | "reparent",
): Promise<DeleteResult> {
  const res = await fetch(`/api/skills/${id}?prune=${prune}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete skill");
  return res.json();
}

export async function batchSaveSkills(skills: Skill[]): Promise<void> {
  const res = await fetch("/api/skills/batch", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(skills),
  });
  if (!res.ok) throw new Error("Failed to batch save skills");
}

export async function runSkill(
  id: string,
  userMessage: string,
  options?: {
    model?: string;
    reasoning?: {
      effort?: "low" | "medium" | "high";
      summary?: "auto" | "concise" | "detailed";
    };
  },
): Promise<RunTraceResult> {
  const res = await fetch(`/api/skills/${id}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userMessage, ...options }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Run failed" }));
    throw new Error(err.error ?? "Run failed");
  }
  return res.json();
}

export async function fetchBenchmarks(): Promise<Benchmark[]> {
  const res = await fetch("/api/benchmarks");
  if (!res.ok) throw new Error("Failed to fetch benchmarks");
  return res.json();
}

export async function createBenchmark(
  id: string,
  name: string,
  description: string,
): Promise<void> {
  const res = await fetch("/api/benchmarks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, name, description }),
  });
  if (!res.ok) throw new Error("Failed to create benchmark");
}

export async function fetchBenchmark(id: string): Promise<Benchmark> {
  const res = await fetch(`/api/benchmarks/${id}`);
  if (!res.ok) throw new Error("Failed to fetch benchmark");
  return res.json();
}

export async function addEvalCase(
  benchmarkId: string,
  evalCase: { id: string; input: string; expected: string; tags: string[] },
): Promise<void> {
  const res = await fetch(`/api/benchmarks/${benchmarkId}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(evalCase),
  });
  if (!res.ok) throw new Error("Failed to add eval case");
}

export async function runBenchmark(
  skillId: string,
  benchmarkId: string,
): Promise<BenchmarkRunResult> {
  const res = await fetch(
    `/api/skills/${skillId}/benchmark/${benchmarkId}/run`,
    { method: "POST" },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Benchmark run failed" }));
    throw new Error(err.error ?? "Benchmark run failed");
  }
  return res.json();
}

// --- Python benchmark ---

export async function fetchPyBenchmarkResults(
  version: string,
): Promise<PyBenchmarkReport[]> {
  const res = await fetch(`/api/py-benchmark?version=${encodeURIComponent(version)}`);
  if (!res.ok) throw new Error("Failed to fetch benchmark results");
  return res.json();
}

export async function triggerPyBenchmarkRun(
  version: string,
): Promise<{ runId: string; status: string }> {
  const res = await fetch("/api/py-benchmark", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ version }),
  });
  if (!res.ok) throw new Error("Failed to trigger benchmark run");
  return res.json();
}

export async function pollPyBenchmarkRunStatus(
  runId: string,
): Promise<PyBenchmarkRunStatus> {
  const res = await fetch(`/api/py-benchmark/status?runId=${encodeURIComponent(runId)}`);
  if (!res.ok) throw new Error("Failed to poll benchmark status");
  return res.json();
}
