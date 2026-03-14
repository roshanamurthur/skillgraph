import { NextResponse } from "next/server";
import { readBenchmark } from "@/lib/store/fs-store";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const benchmark = await readBenchmark(id);
  if (!benchmark) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(benchmark);
}
