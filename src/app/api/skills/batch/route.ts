import { NextResponse } from "next/server";
import { writeSkill } from "@/lib/store/fs-store";
import type { Skill } from "@/lib/types";

export async function PUT(request: Request) {
  const skills: Skill[] = await request.json();
  for (const skill of skills) {
    await writeSkill(skill);
  }
  return NextResponse.json({ saved: skills.length });
}
