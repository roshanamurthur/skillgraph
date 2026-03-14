import { readFile, readdir, stat } from "fs/promises";
import { basename, join, relative, resolve } from "path";
import type { LoadedAgentSkill, LoadOptions, SerializeOptions } from "../types/agent-skill";

const DEFAULT_MAX_FILE_SIZE_BYTES = 100 * 1024; // 100 KB
const DEFAULT_MAX_TOTAL_RESOURCE_BYTES = 500 * 1024; // 500 KB

const TEXT_EXTENSIONS = new Set([
  ".md",
  ".txt",
  ".py",
  ".sh",
  ".bash",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".json",
  ".yaml",
  ".yml",
  ".xml",
  ".html",
  ".css",
  ".csv",
]);

function parseFrontmatter(raw: string): { name: string; description: string } {
  const nameMatch = raw.match(/^name\s*:\s*(.+)$/m);
  const descMatch = raw.match(/^description\s*:\s*(.+)$/m);
  const name = nameMatch ? nameMatch[1].trim().replace(/^["']|["']$/g, "") : "";
  const description = descMatch ? descMatch[1].trim().replace(/^["']|["']$/g, "") : "";
  return { name, description };
}

async function collectTextFiles(
  dirPath: string,
  skillRoot: string,
  options: {
    maxFileSizeBytes: number;
    maxTotalResourceBytes: number;
    totalBytesRef: { current: number };
  }
): Promise<Array<{ relativePath: string; content: string }>> {
  const result: Array<{ relativePath: string; content: string }> = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const ent of entries) {
      const full = join(dir, ent.name);
      const rel = relative(skillRoot, full);
      if (ent.isDirectory()) {
        if (ent.name === "node_modules" || ent.name === ".git") continue;
        await walk(full);
        continue;
      }
      const ext = ent.name.includes(".") ? "." + ent.name.split(".").pop()!.toLowerCase() : "";
      if (!TEXT_EXTENSIONS.has(ext)) continue;
      const st = await stat(full);
      if (!st.isFile() || st.size > options.maxFileSizeBytes) continue;
      if (options.totalBytesRef.current + st.size > options.maxTotalResourceBytes) continue;
      try {
        const content = await readFile(full, "utf-8");
        options.totalBytesRef.current += Buffer.byteLength(content, "utf-8");
        result.push({ relativePath: rel, content });
      } catch {
        // Skip unreadable or non-UTF-8
      }
    }
  }

  await walk(dirPath);
  return result;
}

/**
 * Load an Agent Skills–format directory from disk.
 * Requires SKILL.md; optionally includes scripts/, references/, assets/.
 */
export async function loadAgentSkill(
  skillDirPath: string,
  options: LoadOptions = {}
): Promise<LoadedAgentSkill> {
  const {
    includeResources = true,
    includeScripts = true,
    includeReferences = true,
    includeAssets = true,
    maxFileSizeBytes = DEFAULT_MAX_FILE_SIZE_BYTES,
    maxTotalResourceBytes = DEFAULT_MAX_TOTAL_RESOURCE_BYTES,
  } = options;

  const skillRoot = resolve(skillDirPath);
  const skillPath = join(skillRoot, "SKILL.md");

  let raw: string;
  try {
    raw = await readFile(skillPath, "utf-8");
  } catch (err) {
    throw new Error(`Skill directory must contain SKILL.md: ${skillPath}`);
  }

  const parts = raw.split(/\n---\n/);
  const frontmatter = parts.length >= 2 ? parts[0].trim() : "";
  const body = parts.length >= 2 ? parts.slice(1).join("\n---\n").trim() : raw.trim();

  const { name, description } = parseFrontmatter(frontmatter);
  const finalName = name || basename(skillRoot) || "skill";
  const finalDescription = description || "";

  const resources: Array<{ relativePath: string; content: string }> = [];
  if (includeResources) {
    const totalBytesRef = { current: 0 };
    const sizeOpts = { maxFileSizeBytes, maxTotalResourceBytes, totalBytesRef };
    if (includeScripts) {
      const scriptsDir = join(skillRoot, "scripts");
      try {
        await stat(scriptsDir);
        resources.push(...(await collectTextFiles(scriptsDir, skillRoot, sizeOpts)));
      } catch {
        // no scripts dir
      }
    }
    if (includeReferences) {
      const refDir = join(skillRoot, "references");
      try {
        await stat(refDir);
        resources.push(...(await collectTextFiles(refDir, skillRoot, sizeOpts)));
      } catch {
        // no references dir
      }
    }
    if (includeAssets) {
      const assetsDir = join(skillRoot, "assets");
      try {
        await stat(assetsDir);
        resources.push(...(await collectTextFiles(assetsDir, skillRoot, sizeOpts)));
      } catch {
        // no assets dir
      }
    }
  }

  return {
    name: finalName,
    description: finalDescription,
    body,
    resources: resources.length > 0 ? resources : undefined,
  };
}

/**
 * Serialize a loaded skill into a single string for prepending to the user message.
 */
export function serializeSkillForPrompt(
  loaded: LoadedAgentSkill,
  options: SerializeOptions = {}
): string {
  const { includeHeader = true, includeResources = true } = options;

  const sections: string[] = [];
  if (includeHeader) {
    sections.push("You are using the following skill. Follow its instructions.");
  }
  sections.push(`## Skill: ${loaded.name}`);
  if (loaded.description) {
    sections.push(loaded.description);
  }
  sections.push("\n### Skill instructions\n");
  sections.push(loaded.body);

  if (includeResources && loaded.resources && loaded.resources.length > 0) {
    sections.push("\n### Bundled resources\n");
    for (const { relativePath, content } of loaded.resources) {
      sections.push(`\n## File: ${relativePath}\n\n\`\`\`\n${content}\n\`\`\``);
    }
  }

  return sections.join("\n");
}

/**
 * Load a skill directory, serialize it, and return the instructions string
 * for use as the Responses API `instructions` parameter.
 */
export async function buildSkillInstructions(
  skillDirPath: string,
  options: LoadOptions & { serializeOptions?: SerializeOptions } = {}
): Promise<string> {
  const { serializeOptions, ...loadOptions } = options;
  const loaded = await loadAgentSkill(skillDirPath, loadOptions);
  return serializeSkillForPrompt(loaded, serializeOptions);
}
