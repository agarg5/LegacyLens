import * as dotenv from "dotenv";
import { resolve } from "path";
import { mkdir, writeFile } from "fs/promises";
import { Pinecone } from "@pinecone-database/pinecone";
import { discoverFiles } from "./lib/discover";
import { chunkFile } from "./lib/chunker";
import { embedAndUpsert } from "./lib/embedder";
import type { CodeChunk } from "../src/lib/types";

dotenv.config({ path: ".env.local" });

const CODEBASE_ROOT = process.env.CODEBASE_ROOT || "target-codebase";
const INDEX_NAME = process.env.PINECONE_INDEX || "legacylens";

// Performance targets from CLAUDE.md
const TARGETS = {
  totalTimeSeconds: 300, // 10K+ LOC in <5 minutes
  minLinesOfCode: 10_000,
};

interface BenchmarkReport {
  timestamp: string;
  codebaseRoot: string;
  dryRun: boolean;
  files: number;
  linesOfCode: number;
  chunks: number;
  estimatedTokens: number;
  timing: {
    discoveryMs: number;
    chunkingMs: number;
    embeddingMs: number;
    upsertMs: number;
    totalMs: number;
  };
  throughput: {
    locPerSecond: number;
    chunksPerSecond: number;
  };
  targets: {
    ingestionUnder5Min: { passed: boolean; actual: string; target: string };
    codebaseCoverage: { passed: boolean; actual: string; target: string };
  };
}

const isDryRun = process.argv.includes("--dry-run");

async function benchmark() {
  const root = resolve(CODEBASE_ROOT);
  console.log(`\n=== LegacyLens Ingestion Benchmark ===`);
  console.log(`Codebase: ${root}`);
  if (isDryRun) console.log(`Mode: DRY RUN (skip embedding & upsert)`);
  console.log();

  if (!isDryRun) {
    console.log("Wiping index...");
    const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
    const index = pinecone.index(INDEX_NAME);
    await index.deleteAll();
    console.log("Index wiped.\n");
  }

  const totalStart = Date.now();

  // Stage 1: Discovery
  console.log("Stage 1: File Discovery");
  const discoverStart = Date.now();
  const files = await discoverFiles(root);
  const discoveryMs = Date.now() - discoverStart;
  console.log(`  → ${discoveryMs}ms\n`);

  // Stage 2: Chunking
  console.log("Stage 2: Chunking");
  const chunkStart = Date.now();
  const allChunks: CodeChunk[] = [];
  let totalLines = 0;
  for (const file of files) {
    allChunks.push(...chunkFile(file));
    totalLines += file.lineCount;
  }
  const chunkingMs = Date.now() - chunkStart;
  console.log(`  ${allChunks.length} chunks from ${totalLines.toLocaleString()} LOC`);
  console.log(`  → ${chunkingMs}ms\n`);

  let embeddingMs = 0;
  let upsertMs = 0;
  let estimatedTokens = 0;

  if (isDryRun) {
    estimatedTokens = allChunks.reduce(
      (sum, c) => sum + Math.ceil(c.content.length / 4),
      0,
    );
    console.log("Stage 3: Embedding (SKIPPED — dry run)");
    console.log("Stage 4: Upsert (SKIPPED — dry run)\n");
  } else {
    console.log("Stage 3+4: Embedding & Upsert");
    const stats = await embedAndUpsert(allChunks);
    embeddingMs = stats.embeddingTimeMs;
    upsertMs = stats.upsertTimeMs;
    estimatedTokens = stats.totalTokensEstimate;
    console.log(`  → Embedding: ${embeddingMs}ms, Upsert: ${upsertMs}ms\n`);
  }

  const totalMs = Date.now() - totalStart;
  const locPerSecond = totalMs > 0 ? (totalLines / totalMs) * 1000 : 0;
  const chunksPerSecond = totalMs > 0 ? (allChunks.length / totalMs) * 1000 : 0;

  const report: BenchmarkReport = {
    timestamp: new Date().toISOString(),
    codebaseRoot: root,
    dryRun: isDryRun,
    files: files.length,
    linesOfCode: totalLines,
    chunks: allChunks.length,
    estimatedTokens,
    timing: { discoveryMs, chunkingMs, embeddingMs, upsertMs, totalMs },
    throughput: {
      locPerSecond: Math.round(locPerSecond),
      chunksPerSecond: Math.round(chunksPerSecond * 10) / 10,
    },
    targets: {
      ingestionUnder5Min: {
        passed: isDryRun ? true : totalMs / 1000 < TARGETS.totalTimeSeconds,
        actual: `${(totalMs / 1000).toFixed(1)}s`,
        target: `<${TARGETS.totalTimeSeconds}s`,
      },
      codebaseCoverage: {
        passed: totalLines >= TARGETS.minLinesOfCode,
        actual: `${totalLines.toLocaleString()} LOC`,
        target: `≥${TARGETS.minLinesOfCode.toLocaleString()} LOC`,
      },
    },
  };

  // Print formatted report
  const W = 54;
  const line = "─".repeat(W);
  const dblLine = "═".repeat(W);

  console.log(dblLine);
  console.log("  INGESTION BENCHMARK RESULTS");
  if (isDryRun) console.log("  (DRY RUN — embedding/upsert skipped)");
  console.log(dblLine);
  console.log(`  Files:            ${files.length}`);
  console.log(`  Lines of code:    ${totalLines.toLocaleString()}`);
  console.log(`  Chunks:           ${allChunks.length}`);
  console.log(`  Est. tokens:      ${estimatedTokens.toLocaleString()}`);
  console.log(line);
  console.log("  TIMING");
  console.log(`  Discovery:        ${discoveryMs}ms`);
  console.log(`  Chunking:         ${chunkingMs}ms`);
  if (!isDryRun) {
    console.log(`  Embedding:        ${embeddingMs}ms`);
    console.log(`  Upsert:           ${upsertMs}ms`);
  }
  console.log(`  Total:            ${(totalMs / 1000).toFixed(2)}s`);
  console.log(line);
  console.log("  THROUGHPUT");
  console.log(`  LOC/sec:          ${report.throughput.locPerSecond.toLocaleString()}`);
  console.log(`  Chunks/sec:       ${report.throughput.chunksPerSecond}`);
  console.log(line);
  console.log("  TARGETS");
  for (const [name, t] of Object.entries(report.targets)) {
    const icon = t.passed ? "✓" : "✗";
    console.log(`  ${icon} ${name}: ${t.actual} (target: ${t.target})`);
  }
  console.log(dblLine);

  // Write JSON report
  const reportsDir = resolve("reports");
  await mkdir(reportsDir, { recursive: true });
  const reportPath = resolve(reportsDir, "benchmark.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nReport saved to ${reportPath}\n`);
}

benchmark().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
