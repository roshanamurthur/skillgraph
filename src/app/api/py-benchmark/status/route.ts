import { NextRequest, NextResponse } from "next/server";
import { runningBenchmarks } from "../route";

export async function GET(request: NextRequest) {
  const runId = request.nextUrl.searchParams.get("runId");
  if (!runId) {
    return NextResponse.json(
      { error: "runId query parameter required" },
      { status: 400 },
    );
  }

  const status = runningBenchmarks.get(runId);
  if (!status) {
    return NextResponse.json(
      { error: "Unknown runId" },
      { status: 404 },
    );
  }

  return NextResponse.json(status);
}
