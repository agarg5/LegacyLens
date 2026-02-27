import { openai, CHAT_MODEL } from "./openai";
import type { SearchResult } from "./types";

/**
 * Re-rank search results using GPT-4o-mini as a cross-encoder.
 * Scores each chunk's relevance to the query on a 0-10 scale,
 * then returns the top K results sorted by relevance.
 */
export async function rerankResults(
  query: string,
  results: SearchResult[],
  topK: number,
): Promise<SearchResult[]> {
  if (results.length <= topK) return results;

  try {
    const chunks = results.map((r, i) => ({
      index: i,
      filePath: r.chunk.filePath,
      name: r.chunk.name,
      chunkType: r.chunk.chunkType,
      content: r.chunk.content.slice(0, 200),
    }));

    const completion = await openai.chat.completions.create({
      model: CHAT_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are a code relevance scorer. Given a user query and a list of code chunks, rate each chunk's relevance to the query on a 0-10 scale (10 = highly relevant, 0 = irrelevant).
Return JSON: { "scores": [{ "index": <number>, "score": <number> }] }
Include every chunk index exactly once.`,
        },
        {
          role: "user",
          content: `## Query\n${query}\n\n## Chunks\n${JSON.stringify(chunks)}`,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) return results.slice(0, topK);

    const parsed = JSON.parse(raw) as { scores: { index: number; score: number }[] };
    if (!Array.isArray(parsed.scores)) return results.slice(0, topK);

    const scoreMap = new Map<number, number>();
    for (const s of parsed.scores) {
      if (typeof s.index === "number" && typeof s.score === "number") {
        scoreMap.set(s.index, s.score);
      }
    }

    const reranked = results
      .map((r, i) => ({ result: r, rerankScore: scoreMap.get(i) ?? 0 }))
      .sort((a, b) => b.rerankScore - a.rerankScore)
      .slice(0, topK)
      .map(({ result, rerankScore }) => ({
        ...result,
        rerankScore,
      }));

    return reranked;
  } catch {
    // Graceful degradation: return original results if re-ranking fails
    return results.slice(0, topK);
  }
}
