import { readdir, readFile, writeFile, unlink, mkdir, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import type { Skill, Benchmark, EvalCase, BenchmarkRunResult, PyBenchmarkReport } from "@/lib/types";

const DATA_ROOT = join(process.cwd(), "skillgraph-data");
const SKILLS_DIR = join(DATA_ROOT, "skills");
const BENCHMARKS_DIR = join(DATA_ROOT, "benchmarks");
const TRACES_DIR = join(DATA_ROOT, "traces");
const SKILL_FILES_DIR = join(tmpdir(), "skillgraph");
const EVAL_RESULTS_DIR = join(process.cwd(), "logs", "eval_results");

export async function ensureDataDirs(): Promise<void> {
  await mkdir(SKILLS_DIR, { recursive: true });
  await mkdir(BENCHMARKS_DIR, { recursive: true });
  await mkdir(TRACES_DIR, { recursive: true });
}

// --- Skills ---

export async function readAllSkills(): Promise<Skill[]> {
  await ensureDataDirs();
  let entries: string[];
  try {
    entries = await readdir(SKILLS_DIR);
  } catch {
    return [];
  }
  const skills: Skill[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const raw = await readFile(join(SKILLS_DIR, entry), "utf-8");
    skills.push(JSON.parse(raw) as Skill);
  }
  return skills;
}

export async function readSkill(id: string): Promise<Skill | null> {
  try {
    const raw = await readFile(join(SKILLS_DIR, `${id}.json`), "utf-8");
    return JSON.parse(raw) as Skill;
  } catch {
    return null;
  }
}

export async function writeSkill(skill: Skill): Promise<void> {
  await ensureDataDirs();
  await writeFile(
    join(SKILLS_DIR, `${skill.id}.json`),
    JSON.stringify(skill, null, 2),
  );
}

export async function removeAllSkills(): Promise<void> {
  await ensureDataDirs();
  // Remove skill JSON files
  try {
    const entries = await readdir(SKILLS_DIR);
    for (const entry of entries) {
      if (entry.endsWith(".json")) {
        await unlink(join(SKILLS_DIR, entry));
      }
    }
  } catch { /* dir may not exist */ }

  // Remove benchmark results (logs/eval_results/)
  try {
    await rm(EVAL_RESULTS_DIR, { recursive: true, force: true });
  } catch { /* may not exist */ }

  // Remove benchmark outputs (outputs/)
  const OUTPUTS_DIR = join(process.cwd(), "outputs");
  try {
    await rm(OUTPUTS_DIR, { recursive: true, force: true });
  } catch { /* may not exist */ }

  // Remove traces
  try {
    await rm(TRACES_DIR, { recursive: true, force: true });
    await mkdir(TRACES_DIR, { recursive: true });
  } catch { /* may not exist */ }

  // Remove generated skill files (skill/)
  try {
    await rm(SKILL_FILES_DIR, { recursive: true, force: true });
  } catch { /* may not exist */ }
}

export async function removeSkill(id: string): Promise<void> {
  try {
    await unlink(join(SKILLS_DIR, `${id}.json`));
  } catch {
    // file may not exist
  }
}

function findDescendants(id: string, allSkills: Skill[]): string[] {
  const children = allSkills.filter((s) => s.parentId === id);
  const ids: string[] = [];
  for (const child of children) {
    ids.push(child.id);
    ids.push(...findDescendants(child.id, allSkills));
  }
  return ids;
}

export async function removeSkillSubtree(
  id: string,
  allSkills: Skill[],
): Promise<string[]> {
  const descendants = findDescendants(id, allSkills);
  const toDelete = [id, ...descendants];
  for (const skillId of toDelete) {
    await removeSkill(skillId);
  }
  return toDelete;
}

export async function reparentAndRemove(
  id: string,
  allSkills: Skill[],
): Promise<{ deleted: string[]; reparented: string[] }> {
  const target = allSkills.find((s) => s.id === id);
  const newParentId = target?.parentId ?? null;
  const children = allSkills.filter((s) => s.parentId === id);
  const reparented: string[] = [];

  for (const child of children) {
    const updated = { ...child, parentId: newParentId };
    await writeSkill(updated);
    reparented.push(child.id);
  }

  await removeSkill(id);
  return { deleted: [id], reparented };
}

// --- Benchmarks ---

export async function readAllBenchmarks(): Promise<Benchmark[]> {
  await ensureDataDirs();
  let entries: string[];
  try {
    entries = await readdir(BENCHMARKS_DIR);
  } catch {
    return [];
  }
  const benchmarks: Benchmark[] = [];
  for (const entry of entries) {
    const bm = await readBenchmark(entry);
    if (bm) benchmarks.push(bm);
  }
  return benchmarks;
}

export async function readBenchmark(id: string): Promise<Benchmark | null> {
  const bmDir = join(BENCHMARKS_DIR, id);
  try {
    const raw = await readFile(join(bmDir, "benchmark.json"), "utf-8");
    const meta = JSON.parse(raw) as Benchmark;
    // Load tasks
    const tasksDir = join(bmDir, "tasks");
    let taskEntries: string[];
    try {
      taskEntries = await readdir(tasksDir);
    } catch {
      taskEntries = [];
    }
    const cases: EvalCase[] = [];
    for (const te of taskEntries) {
      if (!te.endsWith(".json")) continue;
      const taskRaw = await readFile(join(tasksDir, te), "utf-8");
      cases.push(JSON.parse(taskRaw) as EvalCase);
    }
    return { ...meta, cases };
  } catch {
    return null;
  }
}

export async function writeBenchmark(
  meta: Omit<Benchmark, "cases">,
): Promise<void> {
  const bmDir = join(BENCHMARKS_DIR, meta.id);
  await mkdir(join(bmDir, "tasks"), { recursive: true });
  await writeFile(
    join(bmDir, "benchmark.json"),
    JSON.stringify(meta, null, 2),
  );
}

export async function appendEvalCase(
  benchmarkId: string,
  evalCase: EvalCase,
): Promise<void> {
  const tasksDir = join(BENCHMARKS_DIR, benchmarkId, "tasks");
  await mkdir(tasksDir, { recursive: true });
  await writeFile(
    join(tasksDir, `${evalCase.id}.json`),
    JSON.stringify(evalCase, null, 2),
  );
}

// --- Traces ---

export async function writeRunResult(
  result: BenchmarkRunResult,
): Promise<void> {
  const dir = join(TRACES_DIR, result.runId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "result.json"), JSON.stringify(result, null, 2));
}

export async function readRunResult(
  runId: string,
): Promise<BenchmarkRunResult | null> {
  try {
    const raw = await readFile(
      join(TRACES_DIR, runId, "result.json"),
      "utf-8",
    );
    return JSON.parse(raw) as BenchmarkRunResult;
  } catch {
    return null;
  }
}

export async function readRunResultsForSkill(
  skillId: string,
): Promise<BenchmarkRunResult[]> {
  await ensureDataDirs();
  let entries: string[];
  try {
    entries = await readdir(TRACES_DIR);
  } catch {
    return [];
  }
  const results: BenchmarkRunResult[] = [];
  for (const entry of entries) {
    try {
      const raw = await readFile(
        join(TRACES_DIR, entry, "result.json"),
        "utf-8",
      );
      const result = JSON.parse(raw) as BenchmarkRunResult;
      if (result.skillId === skillId) {
        results.push(result);
      }
    } catch {
      // skip entries without result.json
    }
  }
  return results;
}

// --- Skill file sync (for Python benchmark) ---

export async function syncSkillFile(skill: Skill): Promise<string | null> {
  const mdFile = skill.files.find(
    (f) => f.name.endsWith(".md") || f.name.endsWith(".skill"),
  );
  if (!mdFile) return null;

  await mkdir(SKILL_FILES_DIR, { recursive: true });

  let content: string;
  if (mdFile.parsed) {
    const fmEntries = Object.entries(mdFile.parsed.frontmatter);
    if (fmEntries.length > 0) {
      const fmLines = fmEntries.map(
        ([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`,
      );
      content = `---\n${fmLines.join("\n")}\n---\n\n${mdFile.parsed.body}`;
    } else {
      content = mdFile.parsed.body;
    }
  } else {
    content = mdFile.content;
  }

  const filename = `skill_v${skill.version}.md`;
  const filepath = join(SKILL_FILES_DIR, filename);
  await writeFile(filepath, content, "utf-8");
  return filepath;
}

// --- Python benchmark results ---

export async function readPyBenchmarkReports(
  version: string,
): Promise<PyBenchmarkReport[]> {
  const dir = join(EVAL_RESULTS_DIR, version);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  // Filter: only timestamped JSON files, skip _located.json and _reparsed.json
  const timestampPattern = /_\d{8}_\d{6}\.json$/;
  const jsonFiles = entries
    .filter(
      (f) =>
        f.endsWith(".json") &&
        timestampPattern.test(f) &&
        !f.includes("_located") &&
        !f.includes("_reparsed"),
    )
    .sort();

  // Group by test_input, keep latest per test
  const latestByTest = new Map<string, string>();
  for (const f of jsonFiles) {
    // e.g. "01_clean_v0_20260314_161410.json" -> test prefix "01_clean"
    const match = f.match(/^(.+?)_v\d+_\d{8}_\d{6}\.json$/);
    const testKey = match ? match[1] : f;
    latestByTest.set(testKey, f); // last one wins (sorted ascending)
  }

  const reports: PyBenchmarkReport[] = [];
  for (const filename of latestByTest.values()) {
    try {
      const raw = await readFile(join(dir, filename), "utf-8");
      reports.push(JSON.parse(raw) as PyBenchmarkReport);
    } catch {
      // skip unparseable files
    }
  }
  return reports;
}
