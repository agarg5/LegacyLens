import { NextResponse } from "next/server";
import { getIndex } from "@/lib/pinecone";
import { EMBEDDING_DIMENSIONS } from "@/lib/openai";
import type { CodeChunk } from "@/lib/types";

export async function POST(req: Request) {
  try {
    const { filePath } = (await req.json()) as { filePath: string };

    if (!filePath) {
      return NextResponse.json({ error: "filePath is required" }, { status: 400 });
    }

    const index = getIndex();
    const zeroVector = new Array(EMBEDDING_DIMENSIONS).fill(0);

    const pineconeResults = await index.query({
      vector: zeroVector,
      topK: 200,
      includeMetadata: true,
      filter: { filePath: { $eq: filePath } },
    });

    const chunks: CodeChunk[] = (pineconeResults.matches ?? [])
      .map((m) => {
        const meta = m.metadata as Record<string, unknown>;
        return {
          id: m.id,
          content: (meta.content as string) ?? "",
          filePath: (meta.filePath as string) ?? "",
          startLine: (meta.startLine as number) ?? 0,
          endLine: (meta.endLine as number) ?? 0,
          chunkType: (meta.chunkType as CodeChunk["chunkType"]) ?? "fixed",
          name: (meta.name as string) ?? "",
          parentSection: meta.parentSection as string | undefined,
          programId: meta.programId as string | undefined,
        };
      })
      .sort((a, b) => a.startLine - b.startLine);

    return NextResponse.json({ chunks });
  } catch (err) {
    console.error("file-context error:", err);
    return NextResponse.json(
      { error: "Failed to fetch file context" },
      { status: 500 },
    );
  }
}
