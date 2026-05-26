import { syncEventsAfter } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const encoder = new TextEncoder();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  let after = Number(url.searchParams.get("after") || "0");
  if (!Number.isFinite(after) || after < 0) after = 0;

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      request.signal.addEventListener("abort", () => {
        closed = true;
        try {
          controller.close();
        } catch {
          // The browser may close first.
        }
      });

      controller.enqueue(encoder.encode(": connected\n\n"));
      const startedAt = Date.now();

      while (!closed && Date.now() - startedAt < 55_000) {
        try {
          const events = await syncEventsAfter(after);
          for (const event of events) {
            after = Math.max(after, event.id);
            controller.enqueue(encoder.encode(`id: ${event.id}\n`));
            controller.enqueue(encoder.encode("event: sync\n"));
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          }
          if (!events.length) {
            controller.enqueue(encoder.encode(": heartbeat\n\n"));
          }
        } catch (error) {
          controller.enqueue(
            encoder.encode(
              `event: sync-error\ndata: ${JSON.stringify({
                message: error instanceof Error ? error.message : "sync error",
              })}\n\n`,
            ),
          );
        }
        await sleep(1200);
      }

      if (!closed) {
        controller.enqueue(encoder.encode("event: reconnect\ndata: {}\n\n"));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
