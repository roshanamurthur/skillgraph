import { NextResponse } from "next/server";
import { readSkill } from "@/lib/store/fs-store";
import { callLLM } from "@/runtime/llm-client";
import { buildInstructionsFromSkill } from "@/runtime/instructions";

interface RunRequest {
  userMessage: string;
  model?: string;
  reasoning?: {
    effort?: "low" | "medium" | "high";
    summary?: "auto" | "concise" | "detailed";
  };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const skill = await readSkill(id);
  if (!skill) {
    return NextResponse.json({ error: "Skill not found" }, { status: 404 });
  }

  const body: RunRequest = await request.json();
  if (!body.userMessage) {
    return NextResponse.json(
      { error: "userMessage is required" },
      { status: 400 },
    );
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY not configured" },
      { status: 500 },
    );
  }

  const instructions = buildInstructionsFromSkill(skill);
  const model = body.model ?? skill.model ?? "gpt-4o";
  const baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";

  try {
    const response = await callLLM({
      model,
      baseUrl,
      apiKey,
      instructions,
      input: [{ role: "user", content: body.userMessage }],
      maxOutputTokens: 4096,
      reasoning: body.reasoning,
    });

    return NextResponse.json({
      content: response.content,
      reasoning: response.reasoning,
      tokenUsage: response.tokenUsage,
      model,
      skillId: id,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
