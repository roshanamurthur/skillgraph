import { NextRequest, NextResponse } from "next/server";
import { runOptimization } from "@/lib/optimization/master-llm";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const body = await request.json();
  const skillId: string = body.skillId;
  if (!skillId) {
    return NextResponse.json(
      { error: "skillId field required" },
      { status: 400 },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of runOptimization(skillId)) {
          const data = `data: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(data));
        }
      } catch (err) {
        const errorEvent = {
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        };
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(errorEvent)}\n\n`),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
