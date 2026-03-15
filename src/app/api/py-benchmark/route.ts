import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { readPyBenchmarkReports } from "@/lib/store/fs-store";
import type { PyBenchmarkRunStatus } from "@/lib/types";

// Module-level map to track running benchmark processes
const runningBenchmarks = new Map<string, PyBenchmarkRunStatus>();

export { runningBenchmarks };

export async function GET(request: NextRequest) {
  const version = request.nextUrl.searchParams.get("version");
  if (!version) {
    return NextResponse.json(
      { error: "version query parameter required" },
      { status: 400 },
    );
  }
  const reports = await readPyBenchmarkReports(version);
  return NextResponse.json(reports);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const version: string = body.version;
  if (!version) {
    return NextResponse.json(
      { error: "version field required" },
      { status: 400 },
    );
  }

  const runId = randomUUID();
  const status: PyBenchmarkRunStatus = {
    runId,
    version,
    status: "running",
    startedAt: new Date().toISOString(),
  };
  runningBenchmarks.set(runId, status);

  const proc = spawn("python3", ["benchmark/run_benchmark.py", "--version", version], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  let stdout = "";
  proc.stdout.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    stdout += text;
    const entry = runningBenchmarks.get(runId);
    if (entry) {
      // Extract the last meaningful line for progress display
      const lines = text.trim().split("\n").filter(Boolean);
      if (lines.length > 0) {
        entry.progress = lines[lines.length - 1];
      }
    }
  });
  proc.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  proc.on("close", (code) => {
    const entry = runningBenchmarks.get(runId);
    if (entry) {
      if (code === 0) {
        entry.status = "completed";
      } else {
        entry.status = "failed";
        entry.error = stderr.slice(-500) || `Process exited with code ${code}`;
      }
    }
  });

  proc.on("error", (err) => {
    const entry = runningBenchmarks.get(runId);
    if (entry) {
      entry.status = "failed";
      entry.error = err.message;
    }
  });

  return NextResponse.json({ runId, status: "running" }, { status: 202 });
}
