import { openai, EMBEDDING_MODEL, EMBEDDING_DIMENSIONS, CHAT_MODEL } from "./openai";
import { getIndex } from "./pinecone";
import { rerankResults } from "./rerank";
import type { CodeChunk, SearchResult, QueryResponse } from "./types";

const TOP_K = 5;

/**
 * Embed a query string and search Pinecone for similar chunks.
 */
export async function searchChunks(query: string, topK = TOP_K): Promise<SearchResult[]> {
  const embRes = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    dimensions: EMBEDDING_DIMENSIONS,
    input: query,
  });

  const queryVector = embRes.data[0].embedding;
  const index = getIndex();

  // Over-fetch 2x candidates for re-ranking
  const fetchK = topK * 2;
  const results = await index.query({
    vector: queryVector,
    topK: fetchK,
    includeMetadata: true,
  });

  const candidates: SearchResult[] = (results.matches ?? []).map((m) => {
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

  return rerankResults(query, candidates, topK);
}

/**
 * Given a user query and retrieved chunks, generate an answer with GPT-4o-mini.
 */
export async function generateAnswer(
  query: string,
  results: SearchResult[],
): Promise<string> {
  const context = results
    .map((r, i) => {
      const c = r.chunk;
      const header = `[${i + 1}] ${c.filePath}:${c.startLine}-${c.endLine} (${c.chunkType}: ${c.name})`;
      return `${header}\n${c.content}`;
    })
    .join("\n\n---\n\n");

  const completion = await openai.chat.completions.create({
    model: CHAT_MODEL,
    temperature: 0.2,
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

  return completion.choices[0]?.message?.content ?? "No answer generated.";
}

/**
 * Full retrieval pipeline: search → generate → return QueryResponse.
 */
export async function queryPipeline(
  query: string,
  topK = TOP_K,
): Promise<QueryResponse> {
  const start = Date.now();

  const results = await searchChunks(query, topK);
  const answer = await generateAnswer(query, results);

  return {
    answer,
    results,
    latencyMs: Date.now() - start,
  };
}
