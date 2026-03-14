import { readdir, readFile, writeFile, unlink, mkdir } from "fs/promises";
import { join } from "path";
import type { Skill, Benchmark, EvalCase } from "@/lib/types";

const DATA_ROOT = join(process.cwd(), "skillgraph-data");
const SKILLS_DIR = join(DATA_ROOT, "skills");
const BENCHMARKS_DIR = join(DATA_ROOT, "benchmarks");
const TRACES_DIR = join(DATA_ROOT, "traces");

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
