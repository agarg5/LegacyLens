import { openai, EMBEDDING_MODEL, EMBEDDING_DIMENSIONS } from "../../src/lib/openai";
import { getIndex } from "../../src/lib/pinecone";
import type { CodeChunk } from "../../src/lib/types";

const EMBED_BATCH_SIZE = 100; // OpenAI limit per request
const UPSERT_BATCH_SIZE = 100; // Pinecone limit per request

export interface EmbedStats {
  totalChunks: number;
  totalTokensEstimate: number;
  embeddingTimeMs: number;
  upsertTimeMs: number;
}

function buildEmbeddingInput(chunk: CodeChunk): string {
  const parts: string[] = [];
  if (chunk.programId) parts.push(`Program: ${chunk.programId}`);
  if (chunk.parentSection) parts.push(`Section: ${chunk.parentSection}`);
  parts.push(`${chunk.chunkType}: ${chunk.name}`);
  parts.push(`File: ${chunk.filePath} (lines ${chunk.startLine}-${chunk.endLine})`);
  parts.push(chunk.content);
  return parts.join("\n");
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    dimensions: EMBEDDING_DIMENSIONS,
    input: texts,
  });
  return response.data.map((d) => d.embedding);
}

export async function embedAndUpsert(chunks: CodeChunk[]): Promise<EmbedStats> {
  const index = getIndex();
  const stats: EmbedStats = {
    totalChunks: chunks.length,
    totalTokensEstimate: 0,
    embeddingTimeMs: 0,
    upsertTimeMs: 0,
  };

  const texts = chunks.map(buildEmbeddingInput);
  stats.totalTokensEstimate = texts.reduce(
    (sum, t) => sum + Math.ceil(t.length / 4),
    0
  );

  // Embed in batches
  const allEmbeddings: number[][] = [];
  const embedStart = Date.now();

  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
    const embeddings = await embedBatch(batch);
    allEmbeddings.push(...embeddings);
    console.log(
      `  Embedded ${Math.min(i + EMBED_BATCH_SIZE, texts.length)}/${texts.length} chunks`
    );
  }

  stats.embeddingTimeMs = Date.now() - embedStart;

  // Upsert in batches
  const upsertStart = Date.now();

  for (let i = 0; i < chunks.length; i += UPSERT_BATCH_SIZE) {
    const batch = chunks.slice(i, i + UPSERT_BATCH_SIZE);
    const vectors = batch.map((chunk, j) => ({
      id: chunk.id,
      values: allEmbeddings[i + j],
      metadata: {
        filePath: chunk.filePath,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        chunkType: chunk.chunkType,
        name: chunk.name,
        parentSection: chunk.parentSection || "",
        programId: chunk.programId || "",
        content: chunk.content.slice(0, 10000), // Pinecone metadata limit
      },
    }));

    await index.upsert({ records: vectors });
    console.log(
      `  Upserted ${Math.min(i + UPSERT_BATCH_SIZE, chunks.length)}/${chunks.length} vectors`
    );
  }

  stats.upsertTimeMs = Date.now() - upsertStart;

  return stats;
}
