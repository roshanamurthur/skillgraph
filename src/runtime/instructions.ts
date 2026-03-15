import type { Skill } from "@/lib/types";

export function buildInstructionsFromSkill(skill: Skill): string {
  const sections: string[] = [];

  if (skill.prompt) {
    sections.push(skill.prompt);
  }

  for (const file of skill.files) {
    if (file.type === "skill" || file.name.endsWith(".md")) {
      if (file.parsed?.body) {
        sections.push(`\n## From file: ${file.name}\n\n${file.parsed.body}`);
      } else if (file.content) {
        sections.push(`\n## From file: ${file.name}\n\n${file.content}`);
      }
    }
  }

  for (const file of skill.files) {
    if (file.type !== "skill" && !file.name.endsWith(".md")) {
      sections.push(
        `\n## Reference file: ${file.name}\n\n\`\`\`\n${file.content}\n\`\`\``,
      );
    }
  }

  return sections.join("\n") || "You are a helpful assistant.";
}
