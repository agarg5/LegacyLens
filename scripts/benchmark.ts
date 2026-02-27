import * as dotenv from "dotenv";
import { resolve } from "path";
import { Pinecone } from "@pinecone-database/pinecone";
import { discoverFiles } from "./lib/discover";
import { chunkFile } from "./lib/chunker";
import { embedAndUpsert } from "./lib/embedder";
import type { CodeChunk } from "../src/lib/types";

dotenv.config({ path: ".env.local" });

const CODEBASE_ROOT = process.env.CODEBASE_ROOT || "target-codebase";
const INDEX_NAME = process.env.PINECONE_INDEX || "legacylens";

async function benchmark() {
  const root = resolve(CODEBASE_ROOT);
  console.log(`\n=== LegacyLens Ingestion Benchmark ===`);
  console.log(`Codebase: ${root}\n`);

  // Wipe index first
  console.log("Wiping index...");
  const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
  const index = pinecone.index(INDEX_NAME);
  await index.deleteAll();
  console.log("Index wiped.\n");

  const totalStart = Date.now();

  // Discover
  const discoverStart = Date.now();
  const files = await discoverFiles(root);
  const discoverMs = Date.now() - discoverStart;

  // Chunk
  const chunkStart = Date.now();
  const allChunks: CodeChunk[] = [];
  let totalLines = 0;
  for (const file of files) {
    allChunks.push(...chunkFile(file));
    totalLines += file.lineCount;
  }
  const chunkMs = Date.now() - chunkStart;

  // Embed + Upsert
  const stats = await embedAndUpsert(allChunks);
  const totalMs = Date.now() - totalStart;

  // Report
  console.log(`\n${"=".repeat(50)}`);
  console.log(`  BENCHMARK RESULTS`);
  console.log(`${"=".repeat(50)}`);
  console.log(`  Files:          ${files.length}`);
  console.log(`  Lines of code:  ${totalLines.toLocaleString()}`);
  console.log(`  Chunks:         ${allChunks.length}`);
  console.log(`  Est. tokens:    ${stats.totalTokensEstimate.toLocaleString()}`);
  console.log(`${"─".repeat(50)}`);
  console.log(`  Discovery:      ${(discoverMs / 1000).toFixed(2)}s`);
  console.log(`  Chunking:       ${(chunkMs / 1000).toFixed(2)}s`);
  console.log(`  Embedding:      ${(stats.embeddingTimeMs / 1000).toFixed(2)}s`);
  console.log(`  Upserting:      ${(stats.upsertTimeMs / 1000).toFixed(2)}s`);
  console.log(`  TOTAL:          ${(totalMs / 1000).toFixed(2)}s`);
  console.log(`${"─".repeat(50)}`);
  console.log(
    `  Throughput:     ${((totalLines / totalMs) * 1000).toFixed(0)} LOC/sec`
  );
  console.log(`${"=".repeat(50)}\n`);
}

benchmark().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
