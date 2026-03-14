import { NextResponse } from "next/server";
import {
  readAllSkills,
  removeSkillSubtree,
  reparentAndRemove,
} from "@/lib/store/fs-store";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const prune = searchParams.get("prune") ?? "subtree";
  const allSkills = await readAllSkills();

  if (prune === "reparent") {
    const result = await reparentAndRemove(id, allSkills);
    return NextResponse.json(result);
  }

  const deleted = await removeSkillSubtree(id, allSkills);
  return NextResponse.json({ deleted });
}
