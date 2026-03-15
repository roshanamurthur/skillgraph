import { NextResponse } from "next/server";
import { readAllSkills, writeSkill, syncSkillFile } from "@/lib/store/fs-store";
import type { Skill } from "@/lib/types";

export async function GET() {
  const skills = await readAllSkills();
  return NextResponse.json(skills);
}

export async function POST(request: Request) {
  const skill: Skill = await request.json();
  await writeSkill(skill);
  await syncSkillFile(skill);
  return NextResponse.json(skill, { status: 201 });
}
