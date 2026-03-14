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
  selected?: boolean;
  [key: string]: unknown;
}
