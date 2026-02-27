import * as dotenv from "dotenv";
import { resolve } from "path";
import { mkdir, writeFile } from "fs/promises";
import { searchChunks } from "../src/lib/retrieval";
import { getIndex } from "../src/lib/pinecone";
import { discoverFiles } from "./lib/discover";

dotenv.config({ path: ".env.local" });

const CODEBASE_ROOT = process.env.CODEBASE_ROOT || "target-codebase";

// Performance targets
const TARGETS = {
  queryLatencyP95Ms: 3000,
  retrievalPrecisionAt5: 0.7,
  coveragePercent: 100,
};

// ─── Hand-crafted Q&A pairs ───────────────────────────────────────────────
// Each pair has a query, expected relevant file paths (substring match),
// and expected keywords that should appear in retrieved chunks.

interface TestCase {
  query: string;
  expectedFiles: string[]; // at least one retrieved chunk should match
  expectedKeywords: string[]; // at least one chunk content should contain these
}

const TEST_CASES: TestCase[] = [
  {
    query: "How does PERFORM VARYING work in GnuCOBOL?",
    expectedFiles: ["cobc/"],
    expectedKeywords: ["PERFORM", "VARYING"],
  },
  {
    query: "How are COBOL data types defined and stored?",
    expectedFiles: ["cobc/"],
    expectedKeywords: ["PIC", "PICTURE", "USAGE"],
  },
  {
    query: "How does GnuCOBOL handle file I/O operations?",
    expectedFiles: ["libcob/", "fileio"],
    expectedKeywords: ["OPEN", "READ", "WRITE", "CLOSE"],
  },
  {
    query: "What is the structure of the COBOL compiler parser?",
    expectedFiles: ["cobc/parser", "cobc/"],
    expectedKeywords: ["parser", "grammar", "token"],
  },
  {
    query: "How does GnuCOBOL implement the MOVE statement?",
    expectedFiles: ["cobc/", "libcob/"],
    expectedKeywords: ["MOVE", "move"],
  },
  {
    query: "What runtime library functions does GnuCOBOL provide?",
    expectedFiles: ["libcob/"],
    expectedKeywords: ["cob_", "runtime"],
  },
  {
    query: "How does error handling work in GnuCOBOL?",
    expectedFiles: ["libcob/", "cobc/"],
    expectedKeywords: ["error", "exception", "ERROR"],
  },
  {
    query: "How are COBOL COPY statements processed?",
    expectedFiles: ["cobc/"],
    expectedKeywords: ["COPY", "copy", "copybook"],
  },
  {
    query: "What numeric operations does GnuCOBOL support?",
    expectedFiles: ["libcob/numeric", "cobc/"],
    expectedKeywords: ["numeric", "ADD", "COMPUTE", "decimal"],
  },
  {
    query: "How does GnuCOBOL handle string manipulation?",
    expectedFiles: ["libcob/", "cobc/"],
    expectedKeywords: ["STRING", "UNSTRING", "INSPECT", "string"],
  },
  {
    query: "What is the memory management approach in GnuCOBOL?",
    expectedFiles: ["libcob/"],
    expectedKeywords: ["alloc", "memory", "free", "cob_"],
  },
  {
    query: "How does GnuCOBOL compile EVALUATE statements?",
    expectedFiles: ["cobc/"],
    expectedKeywords: ["EVALUATE", "WHEN"],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

interface TestResult {
  query: string;
  latencyMs: number;
  retrievedFiles: string[];
  fileMatch: boolean; // did any retrieved chunk match an expected file?
  keywordMatch: boolean; // did any chunk contain expected keywords?
  topScore: number;
  relevant: boolean; // fileMatch AND keywordMatch
}

interface ValidationReport {
  timestamp: string;
  testCases: number;
  latency: {
    p50Ms: number;
    p95Ms: number;
    maxMs: number;
    avgMs: number;
  };
  precision: {
    atK: number;
    score: number; // fraction of test cases with relevant results in top-k
  };
  coverage: {
    indexedFiles: number;
    totalFiles: number;
    percent: number;
  };
  targets: {
    queryLatencyP95: { passed: boolean; actual: string; target: string };
    retrievalPrecision: { passed: boolean; actual: string; target: string };
    codebaseCoverage: { passed: boolean; actual: string; target: string };
  };
  details: TestResult[];
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function validate() {
  console.log(`\n=== LegacyLens Performance Validation ===\n`);

  // 1. Run all test queries
  console.log(`Running ${TEST_CASES.length} test queries...\n`);
  const results: TestResult[] = [];

  for (const tc of TEST_CASES) {
    const start = Date.now();
    const searchResults = await searchChunks(tc.query, 5);
    const latencyMs = Date.now() - start;

    const retrievedFiles = searchResults.map((r) => r.chunk.filePath);

    const fileMatch = searchResults.some((r) =>
      tc.expectedFiles.some((ef) =>
        r.chunk.filePath.toLowerCase().includes(ef.toLowerCase()),
      ),
    );

    const keywordMatch = searchResults.some((r) =>
      tc.expectedKeywords.some((kw) =>
        r.chunk.content.toLowerCase().includes(kw.toLowerCase()),
      ),
    );

    const topScore = searchResults[0]?.score ?? 0;
    const relevant = fileMatch && keywordMatch;

    results.push({
      query: tc.query,
      latencyMs,
      retrievedFiles,
      fileMatch,
      keywordMatch,
      topScore,
      relevant,
    });

    const icon = relevant ? "✓" : "✗";
    console.log(`  ${icon} [${latencyMs}ms] ${tc.query}`);
    if (!relevant) {
      console.log(`    files: ${retrievedFiles.join(", ")}`);
      console.log(`    fileMatch=${fileMatch} keywordMatch=${keywordMatch}`);
    }
  }

  // 2. Compute latency stats
  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);
  const max = latencies[latencies.length - 1];
  const avg = Math.round(latencies.reduce((s, v) => s + v, 0) / latencies.length);

  // 3. Compute retrieval precision
  const relevantCount = results.filter((r) => r.relevant).length;
  const precision = relevantCount / results.length;

  // 4. Check codebase coverage
  console.log(`\nChecking codebase coverage...`);
  const root = resolve(CODEBASE_ROOT);
  const allFiles = await discoverFiles(root);

  const index = getIndex();
  // Query Pinecone for stats
  const statsRes = await index.describeIndexStats();
  const indexedVectors = statsRes.totalRecordCount ?? 0;

  // Check which files have at least one vector indexed
  // We do this by checking unique filePaths in a sample of vectors
  // For a full check, we'd need to list all vectors — instead we check
  // if the file count from discovery matches what we indexed
  const indexedFileSet = new Set<string>();
  for (const file of allFiles) {
    // Search for content from this specific file
    const fileResults = await index.query({
      vector: new Array(1536).fill(0), // dummy vector
      topK: 1,
      includeMetadata: true,
      filter: { filePath: { $eq: file.filePath } },
    });
    if (fileResults.matches && fileResults.matches.length > 0) {
      indexedFileSet.add(file.filePath);
    }
  }

  const coveragePercent =
    allFiles.length > 0
      ? Math.round((indexedFileSet.size / allFiles.length) * 100)
      : 0;

  // Build report
  const report: ValidationReport = {
    timestamp: new Date().toISOString(),
    testCases: TEST_CASES.length,
    latency: { p50Ms: p50, p95Ms: p95, maxMs: max, avgMs: avg },
    precision: { atK: 5, score: Math.round(precision * 100) / 100 },
    coverage: {
      indexedFiles: indexedFileSet.size,
      totalFiles: allFiles.length,
      percent: coveragePercent,
    },
    targets: {
      queryLatencyP95: {
        passed: p95 <= TARGETS.queryLatencyP95Ms,
        actual: `${p95}ms`,
        target: `≤${TARGETS.queryLatencyP95Ms}ms`,
      },
      retrievalPrecision: {
        passed: precision >= TARGETS.retrievalPrecisionAt5,
        actual: `${(precision * 100).toFixed(0)}%`,
        target: `≥${(TARGETS.retrievalPrecisionAt5 * 100).toFixed(0)}%`,
      },
      codebaseCoverage: {
        passed: coveragePercent >= TARGETS.coveragePercent,
        actual: `${coveragePercent}%`,
        target: `${TARGETS.coveragePercent}%`,
      },
    },
    details: results,
  };

  // Print formatted report
  const W = 54;
  const line = "─".repeat(W);
  const dblLine = "═".repeat(W);

  console.log(`\n${dblLine}`);
  console.log("  PERFORMANCE VALIDATION REPORT");
  console.log(dblLine);
  console.log(`  Test cases:       ${TEST_CASES.length}`);
  console.log(line);
  console.log("  QUERY LATENCY");
  console.log(`  p50:              ${p50}ms`);
  console.log(`  p95:              ${p95}ms`);
  console.log(`  max:              ${max}ms`);
  console.log(`  avg:              ${avg}ms`);
  console.log(line);
  console.log("  RETRIEVAL PRECISION @ 5");
  console.log(`  Relevant:         ${relevantCount}/${results.length}`);
  console.log(`  Score:            ${(precision * 100).toFixed(0)}%`);
  console.log(line);
  console.log("  CODEBASE COVERAGE");
  console.log(`  Indexed files:    ${indexedFileSet.size}/${allFiles.length}`);
  console.log(`  Indexed vectors:  ${indexedVectors}`);
  console.log(`  Coverage:         ${coveragePercent}%`);
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
  const reportPath = resolve(reportsDir, "validation.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nReport saved to ${reportPath}\n`);

  // Exit with error if any target failed
  const allPassed = Object.values(report.targets).every((t) => t.passed);
  if (!allPassed) {
    console.log("⚠ Some targets did not pass.\n");
    process.exit(1);
  }
}

validate().catch((err) => {
  console.error("Validation failed:", err);
  process.exit(1);
});
