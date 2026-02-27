import * as dotenv from "dotenv";
import { resolve } from "path";
import { discoverFiles } from "./lib/discover";
import { chunkFile } from "./lib/chunker";
import { embedAndUpsert } from "./lib/embedder";
import type { CodeChunk } from "../src/lib/types";

dotenv.config({ path: ".env.local" });

const CODEBASE_ROOT = process.env.CODEBASE_ROOT || "target-codebase";

async function ingest() {
  const root = resolve(CODEBASE_ROOT);
  console.log(`\n=== LegacyLens Ingestion Pipeline ===`);
  console.log(`Codebase: ${root}\n`);

  const totalStart = Date.now();

  // Step 1: Discover files
  console.log("Step 1: Discovering files...");
  const files = await discoverFiles(root);
  if (files.length === 0) {
    console.error("No files found. Check CODEBASE_ROOT path.");
    process.exit(1);
  }

  // Step 2: Chunk files
  console.log("\nStep 2: Chunking files...");
  const allChunks: CodeChunk[] = [];
  let cobolFiles = 0;
  let otherFiles = 0;

  for (const file of files) {
    const chunks = chunkFile(file);
    allChunks.push(...chunks);

    if ([".cob", ".cbl", ".cpy"].includes(file.extension)) {
      cobolFiles++;
    } else {
      otherFiles++;
    }
  }

  console.log(`  ${cobolFiles} COBOL files → syntax-aware chunking`);
  console.log(`  ${otherFiles} other files → fixed-size chunking`);
  console.log(`  Total chunks: ${allChunks.length}`);

  // Step 3: Embed and upsert
  console.log("\nStep 3: Embedding and upserting to Pinecone...");
  const stats = await embedAndUpsert(allChunks);

  const totalMs = Date.now() - totalStart;

  // Summary
  console.log(`\n=== Ingestion Complete ===`);
  console.log(`  Files processed: ${files.length}`);
  console.log(`  Chunks created:  ${allChunks.length}`);
  console.log(`  Est. tokens:     ${stats.totalTokensEstimate.toLocaleString()}`);
  console.log(`  Embedding time:  ${(stats.embeddingTimeMs / 1000).toFixed(1)}s`);
  console.log(`  Upsert time:     ${(stats.upsertTimeMs / 1000).toFixed(1)}s`);
  console.log(`  Total time:      ${(totalMs / 1000).toFixed(1)}s`);
  console.log();
}

ingest().catch((err) => {
  console.error("Ingestion failed:", err);
  process.exit(1);
});
