import { NextRequest } from "next/server";
import { openai, EMBEDDING_MODEL, EMBEDDING_DIMENSIONS, CHAT_MODEL } from "@/lib/openai";
import { getIndex } from "@/lib/pinecone";
import { rerankResults } from "@/lib/rerank";
import type { CodeChunk, SearchResult } from "@/lib/types";

const TOP_K = 5;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const query = body.query;
    if (!query || typeof query !== "string") {
      return new Response(JSON.stringify({ error: "Missing 'query' string in body" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const topK = typeof body.topK === "number" ? body.topK : TOP_K;

    // Step 1: Search (non-streamed) — over-fetch 2x for re-ranking
    const embRes = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      dimensions: EMBEDDING_DIMENSIONS,
      input: query,
    });
    const queryVector = embRes.data[0].embedding;
    const index = getIndex();
    const pineconeResults = await index.query({
      vector: queryVector,
      topK: topK * 2,
      includeMetadata: true,
    });

    const candidates: SearchResult[] = (pineconeResults.matches ?? []).map((m) => {
      const meta = m.metadata as Record<string, unknown>;
      return {
        chunk: {
          id: m.id,
          content: (meta.content as string) ?? "",
          filePath: (meta.filePath as string) ?? "",
          startLine: (meta.startLine as number) ?? 0,
          endLine: (meta.endLine as number) ?? 0,
          chunkType: (meta.chunkType as CodeChunk["chunkType"]) ?? "fixed",
          name: (meta.name as string) ?? "",
          parentSection: meta.parentSection as string | undefined,
          programId: meta.programId as string | undefined,
        },
        score: m.score ?? 0,
      };
    });

    const results = await rerankResults(query, candidates, topK);

    // Step 2: Build context for LLM
    const context = results
      .map((r, i) => {
        const c = r.chunk;
        const header = `[${i + 1}] ${c.filePath}:${c.startLine}-${c.endLine} (${c.chunkType}: ${c.name})`;
        return `${header}\n${c.content}`;
      })
      .join("\n\n---\n\n");

    // Step 3: Stream the LLM answer
    const stream = await openai.chat.completions.create({
      model: CHAT_MODEL,
      temperature: 0.2,
      stream: true,
      messages: [
        {
          role: "system",
          content: `You are a legacy code expert helping developers understand a GnuCOBOL codebase.
Answer the user's question using ONLY the provided code snippets.
Always cite file paths and line numbers when referencing code (e.g., "in file.cob:42-50").
If the snippets don't contain enough information to answer, say so clearly.
Be concise and precise.`,
        },
        {
          role: "user",
          content: `## Retrieved Code Snippets\n\n${context}\n\n## Question\n${query}`,
        },
      ],
    });

    // SSE response: first event sends search results, then stream tokens
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        // Send search results as first event
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "sources", results })}\n\n`),
        );

        // Stream LLM tokens
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: "token", content: delta })}\n\n`),
            );
          }
        }

        // Signal done
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`));
        controller.close();
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
