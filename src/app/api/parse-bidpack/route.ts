import { NextResponse } from "next/server";
import { parseBidPackPdf } from "@/lib/pdf-parser";
import { MAX_PDF_BYTES } from "@/lib/pdf-parser/constants";
import { checkRateLimit, clientIp, rateLimitedResponse } from "@/lib/server/rate-limit";

// pdfjs-dist needs Node APIs (Buffer, etc.), not the edge runtime.
export const runtime = "nodejs";
// A 400-page pack takes up to ~12s to parse on a cold function; don't let the platform default cut it off mid-parse.
export const maxDuration = 60;

export async function POST(request: Request) {
  // Parsing costs only CPU (no paid API), and every pilot uploads within hours of bid release — often behind shared wifi — so this allows a crowd from one address.
  const { ok } = await checkRateLimit("parse-bidpack", clientIp(request), 40, 60 * 60);
  if (!ok) return rateLimitedResponse();

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected a multipart form upload." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file was uploaded." }, { status: 400 });
  }

  if (file.type && file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ error: "Only PDF files are supported." }, { status: 400 });
  }

  if (file.size > MAX_PDF_BYTES) {
    return NextResponse.json(
      { error: `File is too large (${Math.round(file.size / 1024 / 1024)}MB). Max size is ${Math.round(MAX_PDF_BYTES / 1024 / 1024)}MB.` },
      { status: 400 }
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  // The upload screen asks for newline-delimited JSON so it can show the
  // parse happening for real — pages read, pairings found, lines built —
  // then the result as the last line. Any other caller gets the plain JSON
  // response exactly as before.
  if (request.headers.get("accept")?.includes("application/x-ndjson")) {
    return streamParse(bytes);
  }

  try {
    const result = await parseBidPackPdf(bytes);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      {
        error: "Something went wrong while parsing this PDF.",
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 500 }
    );
  }
}

/**
 * The parse, streamed as it happens: `{"type":"progress",...}` lines (see
 * `ParseProgress`), then one `{"type":"result"}` or `{"type":"error"}`.
 * Page events are thinned to every third page plus the last, which still
 * reads as a smooth count without sending hundreds of lines.
 */
function streamParse(bytes: Uint8Array): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (message: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(message)}\n`));
      let lastPageSent = 0;
      try {
        const result = await parseBidPackPdf(bytes, {
          onProgress: (progress) => {
            if (progress.stage === "pages") {
              if (progress.done !== progress.total && progress.done - lastPageSent < 3) return;
              lastPageSent = progress.done;
            }
            send({ type: "progress", ...progress });
          },
        });
        send({ type: "result", result });
      } catch (e) {
        send({
          type: "error",
          error: "Something went wrong while parsing this PDF.",
          detail: e instanceof Error ? e.message : String(e),
        });
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      // Keep proxies from buffering the stream into one late chunk.
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
