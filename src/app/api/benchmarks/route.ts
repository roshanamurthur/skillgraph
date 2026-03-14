import { NextResponse } from "next/server";
import { readAllBenchmarks, writeBenchmark } from "@/lib/store/fs-store";
import type { Benchmark } from "@/lib/types";

export async function GET() {
  const benchmarks = await readAllBenchmarks();
  return NextResponse.json(benchmarks);
}

export async function POST(request: Request) {
  const body: Omit<Benchmark, "cases"> = await request.json();
  await writeBenchmark(body);
  return NextResponse.json(body, { status: 201 });
}
