// Shared interfaces (Skill, Trace, Benchmark, etc.)

export interface SkillFile {
  id: string;
  name: string;
  type: "skill" | "json" | "yaml" | "text";
  content: string;
  parsed: ParsedSkillFile | null;
  addedAt: string;
}

export interface ParsedSkillFile {
  frontmatter: Record<string, unknown>;
  body: string;
}

export interface Skill {
  id: string;
  name: string;
  version: number;
  parentId: string | null;
  prompt: string;
  model: string;
  score: number | null;
  files: SkillFile[];
  createdAt: string;
}

export interface SkillNodeData {
  skill: Skill;
  depth: number;
  selected?: boolean;
  [key: string]: unknown;
}

export interface EvalCase {
  id: string;
  input: string;
  expected: string;
  tags: string[];
}

export interface Benchmark {
  id: string;
  name: string;
  description: string;
  cases: EvalCase[];
}

export interface Trace {
  traceId: string;
  runId: string;
  skillId: string;
  evalCaseId: string;
  outcome: string;
  metrics: Record<string, number>;
}

export interface DeleteResult {
  deleted: string[];
  reparented?: string[];
}
