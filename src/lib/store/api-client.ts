import type { Skill, DeleteResult } from "@/lib/types";

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
