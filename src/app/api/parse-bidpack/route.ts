import { NextResponse } from "next/server";
import { parseBidPackPdf } from "@/lib/pdf-parser";
import { MAX_PDF_BYTES } from "@/lib/pdf-parser/constants";

// pdfjs-dist needs Node APIs (Buffer, etc.), not the edge runtime.
export const runtime = "nodejs";

export async function POST(request: Request) {
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
