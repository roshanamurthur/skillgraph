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

export interface RunTraceResult {
  content: string;
  reasoning: string | null;
  tokenUsage: { input: number; output: number; reasoning?: number };
  model: string;
  skillId: string;
  timestamp: string;
  error?: string;
}

export interface BenchmarkCaseResult {
  evalCaseId: string;
  input: string;
  expected: string;
  actual: string;
  passed: boolean;
  reasoning: string | null;
  tokenUsage: { input: number; output: number; reasoning?: number };
  wallClockMs: number;
}

export interface BenchmarkRunResult {
  runId: string;
  skillId: string;
  benchmarkId: string;
  timestamp: string;
  results: BenchmarkCaseResult[];
  score: number;
  totalTokens: number;
  totalWallClockMs: number;
}

// --- Python benchmark report types ---

export interface PyBenchmarkCheck {
  check: string;
  passed?: boolean;
  actual: number | string | boolean;
  expected?: number | string | boolean;
  delta?: number | null;
  description?: string;
  cell?: string;
  sheet?: string;
  row?: number;
  column_letter?: string;
  column_name?: string;
  entity?: string;
}

export interface PyBenchmarkCategory {
  fraction: string;
  score: number;
  passed: number;
  total: number;
  passed_checks: PyBenchmarkCheck[];
  failed_checks: PyBenchmarkCheck[];
}

export interface PyBenchmarkReport {
  test_input: string;
  skill_version: string;
  timestamp: string;
  reasoning_trace?: string | null;
  token_usage?: { input: number; output: number; reasoning: number };
  error?: string;
  overall: { fraction: string; score: number; passed: number; total: number };
  categories: Record<string, PyBenchmarkCategory>;
  failures_by_location?: Record<string, Record<string, string[]>>;
}

export interface PyBenchmarkRunStatus {
  runId: string;
  version: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  error?: string;
  progress?: string;
}
