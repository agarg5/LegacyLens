import { NextRequest } from "next/server";
import { openai, EMBEDDING_MODEL, EMBEDDING_DIMENSIONS, CHAT_MODEL } from "@/lib/openai";
import { getIndex } from "@/lib/pinecone";
import { rerankResults } from "@/lib/rerank";
import type { CodeChunk, SearchResult, AnalysisMode } from "@/lib/types";
import { MODE_CONFIGS } from "@/lib/prompts";

const VALID_MODES = new Set<AnalysisMode>(["explain", "dependencies", "documentation", "business-logic"]);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const query = body.query;
    const mode = body.mode as AnalysisMode;

    if (!query || typeof query !== "string") {
      return new Response(JSON.stringify({ error: "Missing 'query' string in body" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (!mode || !VALID_MODES.has(mode)) {
      return new Response(
        JSON.stringify({ error: `Invalid mode. Must be one of: ${[...VALID_MODES].join(", ")}` }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const config = MODE_CONFIGS[mode];
    const topK = typeof body.topK === "number" ? body.topK : config.defaultTopK;

    // Augment query for better retrieval if mode has a queryPrefix
    const searchQuery = config.queryPrefix ? config.queryPrefix + query : query;

    // Step 1: Search — over-fetch 2x for re-ranking
    const embRes = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      dimensions: EMBEDDING_DIMENSIONS,
      input: searchQuery,
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

    // Re-rank using raw query (not searchQuery with mode prefix)
    const results = await rerankResults(query, candidates, topK);

    // Quality gate: skip LLM if retrieval is irrelevant
    const RERANK_THRESHOLD = 3;
    const PINECONE_THRESHOLD = 0.3;
    const topResult = results[0];
    const topScore = topResult?.rerankScore ?? topResult?.score ?? 0;
    const threshold = topResult?.rerankScore !== undefined ? RERANK_THRESHOLD : PINECONE_THRESHOLD;

    if (!topResult || topScore < threshold) {
      const encoder = new TextEncoder();
      const readable = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "sources", results: [] })}\n\n`),
          );
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "token", content: "No relevant code found for this query. Try being more specific or using terms from the codebase (e.g., file names, COBOL keywords, or program identifiers)." })}\n\n`,
            ),
          );
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
    }

    // Step 2: Build context for LLM
    const context = results
      .map((r, i) => {
        const c = r.chunk;
        const header = `[${i + 1}] ${c.filePath}:${c.startLine}-${c.endLine} (${c.chunkType}: ${c.name})`;
        return `${header}\n${c.content}`;
      })
      .join("\n\n---\n\n");

    // Step 3: Stream the LLM answer with mode-specific system prompt
    const stream = await openai.chat.completions.create({
      model: CHAT_MODEL,
      temperature: 0.2,
      stream: true,
      messages: [
        { role: "system", content: config.systemPrompt },
        { role: "user", content: `## Retrieved Code Snippets\n\n${context}\n\n## Request\n${query}` },
      ],
    });

    // SSE response: first event sends search results, then stream tokens
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "sources", results })}\n\n`),
        );

        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: "token", content: delta })}\n\n`),
            );
          }
        }

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
