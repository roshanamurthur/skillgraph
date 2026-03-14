import yaml from "js-yaml";
import type { ParsedSkillFile, SkillFile } from "@/lib/types";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseFrontmatter(raw: string): ParsedSkillFile | null {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) return null;

  try {
    const frontmatter = yaml.load(match[1]) as Record<string, unknown>;
    return { frontmatter, body: match[2].trim() };
  } catch {
    return null;
  }
}

function detectFileType(name: string): SkillFile["type"] {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "json") return "json";
  if (ext === "yaml" || ext === "yml") return "yaml";
  if (ext === "md" || ext === "skill") return "skill";
  return "text";
}

export function createSkillFile(
  id: string,
  name: string,
  content: string,
): SkillFile {
  const type = detectFileType(name);
  let parsed: ParsedSkillFile | null = null;

  if (type === "skill" || type === "text") {
    parsed = parseFrontmatter(content);
  } else if (type === "json") {
    try {
      const data = JSON.parse(content);
      parsed = { frontmatter: data, body: "" };
    } catch {
      /* invalid JSON, leave parsed null */
    }
  } else if (type === "yaml") {
    try {
      const data = yaml.load(content) as Record<string, unknown>;
      parsed = { frontmatter: data, body: "" };
    } catch {
      /* invalid YAML, leave parsed null */
    }
  }

  return { id, name, type, content, parsed, addedAt: new Date().toISOString() };
}
