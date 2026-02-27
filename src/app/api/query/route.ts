import { NextRequest, NextResponse } from "next/server";
import { queryPipeline } from "@/lib/retrieval";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const query = body.query;

    if (!query || typeof query !== "string") {
      return NextResponse.json({ error: "Missing 'query' string in body" }, { status: 400 });
    }

    const topK = typeof body.topK === "number" ? body.topK : undefined;

    const response = await queryPipeline(query, topK);
    return NextResponse.json(response);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
