import { NextResponse } from "next/server";
import { appendEvalCase } from "@/lib/store/fs-store";
import type { EvalCase } from "@/lib/types";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const evalCase: EvalCase = await request.json();
  await appendEvalCase(id, evalCase);
  return NextResponse.json(evalCase, { status: 201 });
}
