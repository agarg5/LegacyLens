import { NextRequest, NextResponse } from "next/server";
import { queryPipeline } from "@/lib/retrieval";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const query = body.query;

  if (!query || typeof query !== "string") {
    return NextResponse.json({ error: "Missing 'query' string in body" }, { status: 400 });
  }

  const topK = typeof body.topK === "number" ? body.topK : undefined;

  const response = await queryPipeline(query, topK);
  return NextResponse.json(response);
}
