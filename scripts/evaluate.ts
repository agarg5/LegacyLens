import * as dotenv from "dotenv";
import { resolve } from "path";
import { mkdir, writeFile } from "fs/promises";
import { searchChunks } from "../src/lib/retrieval";
import { openai, CHAT_MODEL } from "../src/lib/openai";
import type { SearchResult, AnalysisMode } from "../src/lib/types";
import { MODE_CONFIGS } from "../src/lib/prompts";

dotenv.config({ path: ".env.local" });

// ─── Mode types ──────────────────────────────────────────────────────────

type EvalMode = "general" | AnalysisMode;

const GENERAL_SYSTEM_PROMPT = `You are a legacy code expert helping developers understand a GnuCOBOL codebase.
Answer the user's question using ONLY the provided code snippets.
Always cite file paths and line numbers when referencing code (e.g., "in file.cob:42-50").
If the snippets don't contain enough information to answer, say so clearly.
Be concise and precise.`;

// ─── Test case definitions ───────────────────────────────────────────────

interface EvalTestCase {
  mode: EvalMode;
  query: string;
  expectedFiles: string[];       // at least one retrieved chunk should match (substring)
  expectedKeywords: string[];    // at least one chunk content should contain these
  responseChecks: string[];      // keywords expected in the LLM-generated answer
  description: string;           // human-readable description of what we're testing
}

const TEST_CASES: EvalTestCase[] = [
  // ── General query (baseline) ────────────────────────────────────────
  {
    mode: "general",
    query: "How does GnuCOBOL handle file I/O operations?",
    expectedFiles: ["libcob/", "fileio"],
    expectedKeywords: ["OPEN", "READ", "WRITE", "CLOSE"],
    responseChecks: ["file", "open", "read"],
    description: "General: file I/O operations",
  },
  {
    mode: "general",
    query: "What runtime library functions does GnuCOBOL provide?",
    expectedFiles: ["libcob/"],
    expectedKeywords: ["cob_", "runtime"],
    responseChecks: ["cob_", "libcob"],
    description: "General: runtime library",
  },

  // ── Explain mode ────────────────────────────────────────────────────
  {
    mode: "explain",
    query: "Explain the PROCEDURE DIVISION of cobxref.cob",
    expectedFiles: ["cobxref", "cobc/"],
    expectedKeywords: ["PROCEDURE", "DIVISION", "PERFORM"],
    responseChecks: ["procedure", "division"],
    description: "Explain: PROCEDURE DIVISION walkthrough",
  },
  {
    mode: "explain",
    query: "Explain how INSPECT statement processing works",
    expectedFiles: ["libcob/", "cobc/"],
    expectedKeywords: ["INSPECT", "inspect", "TALLYING"],
    responseChecks: ["inspect"],
    description: "Explain: INSPECT statement processing",
  },
  {
    mode: "explain",
    query: "Explain the numeric comparison logic in GnuCOBOL",
    expectedFiles: ["libcob/numeric", "cobc/"],
    expectedKeywords: ["compar", "numeric", "cob_"],
    responseChecks: ["compar"],
    description: "Explain: numeric comparison",
  },

  // ── Dependencies mode ───────────────────────────────────────────────
  {
    mode: "dependencies",
    query: "What are the dependencies of the compiler main module?",
    expectedFiles: ["cobc/"],
    expectedKeywords: ["CALL", "PERFORM", "cob_", "include"],
    responseChecks: ["call", "depend"],
    description: "Dependencies: compiler main module",
  },
  {
    mode: "dependencies",
    query: "What are the dependencies of the file I/O module?",
    expectedFiles: ["libcob/fileio", "libcob/"],
    expectedKeywords: ["cob_", "file", "open"],
    responseChecks: ["file", "depend"],
    description: "Dependencies: file I/O module",
  },
  {
    mode: "dependencies",
    query: "Map the dependencies of the parser module",
    expectedFiles: ["cobc/parser", "cobc/"],
    expectedKeywords: ["parser", "token", "grammar"],
    responseChecks: ["parser", "depend"],
    description: "Dependencies: parser module",
  },

  // ── Documentation mode ──────────────────────────────────────────────
  {
    mode: "documentation",
    query: "Generate documentation for the screen handling module",
    expectedFiles: ["libcob/screen", "cobc/"],
    expectedKeywords: ["screen", "SCREEN", "DISPLAY", "ACCEPT"],
    responseChecks: ["screen", "display"],
    description: "Documentation: screen handling",
  },
  {
    mode: "documentation",
    query: "Generate documentation for the SORT/MERGE implementation",
    expectedFiles: ["libcob/", "cobc/"],
    expectedKeywords: ["SORT", "MERGE", "sort"],
    responseChecks: ["sort"],
    description: "Documentation: SORT/MERGE",
  },
  {
    mode: "documentation",
    query: "Generate documentation for the string handling functions",
    expectedFiles: ["libcob/strings", "libcob/"],
    expectedKeywords: ["STRING", "UNSTRING", "string"],
    responseChecks: ["string"],
    description: "Documentation: string handling",
  },

  // ── Business Logic mode ─────────────────────────────────────────────
  {
    mode: "business-logic",
    query: "What business rules govern the EVALUATE statement handling?",
    expectedFiles: ["cobc/"],
    expectedKeywords: ["EVALUATE", "WHEN", "evaluate"],
    responseChecks: ["evaluate", "when"],
    description: "Business Logic: EVALUATE handling",
  },
  {
    mode: "business-logic",
    query: "What validation rules exist for numeric data types?",
    expectedFiles: ["cobc/", "libcob/"],
    expectedKeywords: ["numeric", "valid", "PIC", "USAGE"],
    responseChecks: ["numeric", "valid"],
    description: "Business Logic: numeric validation",
  },
  {
    mode: "business-logic",
    query: "What business rules govern COBOL MOVE statement type conversions?",
    expectedFiles: ["cobc/", "libcob/"],
    expectedKeywords: ["MOVE", "move", "convert"],
    responseChecks: ["move"],
    description: "Business Logic: MOVE conversions",
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

async function generateWithMode(
  query: string,
  chunks: SearchResult[],
  mode: EvalMode,
): Promise<string> {
  const context = chunks
    .map((r, i) => {
      const c = r.chunk;
      const header = `[${i + 1}] ${c.filePath}:${c.startLine}-${c.endLine} (${c.chunkType}: ${c.name})`;
      return `${header}\n${c.content}`;
    })
    .join("\n\n---\n\n");

  const systemPrompt =
    mode === "general" ? GENERAL_SYSTEM_PROMPT : MODE_CONFIGS[mode].systemPrompt;

  const completion = await openai.chat.completions.create({
    model: CHAT_MODEL,
    temperature: 0.2,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `## Retrieved Code Snippets\n\n${context}\n\n## Question\n${query}` },
    ],
  });

  return completion.choices[0]?.message?.content ?? "";
}

// ─── Result types ─────────────────────────────────────────────────────────

interface EvalResult {
  mode: EvalMode;
  description: string;
  query: string;
  retrievalLatencyMs: number;    // embedding + Pinecone search only
  totalLatencyMs: number;        // retrieval + LLM generation
  retrievedFiles: string[];
  fileMatch: boolean;
  keywordMatch: boolean;
  responseChecksPassed: number;
  responseChecksTotal: number;
  topScore: number;
  retrievalRelevant: boolean;    // fileMatch AND keywordMatch
  responseRelevant: boolean;     // majority of responseChecks passed
  overallPass: boolean;          // retrieval AND response relevant
}

interface ModeStats {
  mode: EvalMode;
  testCases: number;
  retrievalPrecision: number;    // fraction with relevant retrieval
  responsePrecision: number;     // fraction with relevant response
  overallPassRate: number;
  avgRetrievalLatencyMs: number;
  p95RetrievalLatencyMs: number;
  avgTotalLatencyMs: number;
  p95TotalLatencyMs: number;
}

interface EvalReport {
  timestamp: string;
  totalTestCases: number;
  overallPassRate: number;
  overallRetrievalPrecision: number;
  overallResponsePrecision: number;
  retrievalLatency: {
    p50Ms: number;
    p95Ms: number;
    maxMs: number;
    avgMs: number;
  };
  totalLatency: {
    p50Ms: number;
    p95Ms: number;
    maxMs: number;
    avgMs: number;
  };
  modeStats: ModeStats[];
  details: EvalResult[];
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function evaluate() {
  console.log(`\n=== LegacyLens Evaluation Suite ===\n`);
  console.log(`Running ${TEST_CASES.length} test cases across ${new Set(TEST_CASES.map((t) => t.mode)).size} modes...\n`);

  // Run test cases with concurrency to reduce wall time
  const CONCURRENCY = 4;
  const results: EvalResult[] = [];

  async function runTestCase(tc: EvalTestCase): Promise<EvalResult> {
    const modeConfig = tc.mode !== "general" ? MODE_CONFIGS[tc.mode] : null;
    const topK = modeConfig?.defaultTopK ?? 5;

    const searchQuery = modeConfig?.queryPrefix
      ? `${modeConfig.queryPrefix} ${tc.query}`
      : tc.query;

    // 1. Retrieval (timed separately)
    const retrievalStart = Date.now();
    const searchResults = await searchChunks(searchQuery, topK);
    const retrievalLatencyMs = Date.now() - retrievalStart;

    // 2. Generation
    const genStart = Date.now();
    const answer = await generateWithMode(tc.query, searchResults, tc.mode);
    const totalLatencyMs = retrievalLatencyMs + (Date.now() - genStart);

    // 3. Score retrieval
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
    const retrievalRelevant = fileMatch && keywordMatch;

    // 4. Score response
    const answerLower = answer.toLowerCase();
    const checksPassedCount = tc.responseChecks.filter((kw) =>
      answerLower.includes(kw.toLowerCase()),
    ).length;
    const responseRelevant = checksPassedCount >= Math.ceil(tc.responseChecks.length / 2);

    const overallPass = retrievalRelevant && responseRelevant;

    return {
      mode: tc.mode,
      description: tc.description,
      query: tc.query,
      retrievalLatencyMs,
      totalLatencyMs,
      retrievedFiles,
      fileMatch,
      keywordMatch,
      responseChecksPassed: checksPassedCount,
      responseChecksTotal: tc.responseChecks.length,
      topScore,
      retrievalRelevant,
      responseRelevant,
      overallPass,
    };
  }

  // Process in batches of CONCURRENCY
  for (let i = 0; i < TEST_CASES.length; i += CONCURRENCY) {
    const batch = TEST_CASES.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map(runTestCase));

    for (const result of batchResults) {
      results.push(result);
      const icon = result.overallPass ? "✓" : "✗";
      const modeTag = `[${result.mode}]`.padEnd(17);
      console.log(`  ${icon} ${modeTag} [retrieval=${result.retrievalLatencyMs}ms total=${result.totalLatencyMs}ms] ${result.description}`);
      if (!result.overallPass) {
        console.log(`    retrieval=${result.retrievalRelevant} response=${result.responseRelevant} (${result.responseChecksPassed}/${result.responseChecksTotal} checks)`);
        if (!result.retrievalRelevant) {
          console.log(`    files: ${result.retrievedFiles.join(", ")}`);
        }
      }
    }
  }

  // ─── Compute stats ──────────────────────────────────────────────────

  // Retrieval latency (for assignment target)
  const retrievalLatencies = results.map((r) => r.retrievalLatencyMs).sort((a, b) => a - b);
  const retP50 = percentile(retrievalLatencies, 50);
  const retP95 = percentile(retrievalLatencies, 95);
  const retMax = retrievalLatencies[retrievalLatencies.length - 1];
  const retAvg = Math.round(retrievalLatencies.reduce((s, v) => s + v, 0) / retrievalLatencies.length);

  // Total latency (informational — includes LLM generation)
  const totalLatencies = results.map((r) => r.totalLatencyMs).sort((a, b) => a - b);
  const totP50 = percentile(totalLatencies, 50);
  const totP95 = percentile(totalLatencies, 95);
  const totMax = totalLatencies[totalLatencies.length - 1];
  const totAvg = Math.round(totalLatencies.reduce((s, v) => s + v, 0) / totalLatencies.length);

  // Per-mode stats
  const modes: EvalMode[] = ["general", "explain", "dependencies", "documentation", "business-logic"];
  const modeStats: ModeStats[] = modes
    .map((mode) => {
      const modeResults = results.filter((r) => r.mode === mode);
      if (modeResults.length === 0) return null;
      const modeRetLatencies = modeResults.map((r) => r.retrievalLatencyMs).sort((a, b) => a - b);
      const modeTotLatencies = modeResults.map((r) => r.totalLatencyMs).sort((a, b) => a - b);
      return {
        mode,
        testCases: modeResults.length,
        retrievalPrecision: modeResults.filter((r) => r.retrievalRelevant).length / modeResults.length,
        responsePrecision: modeResults.filter((r) => r.responseRelevant).length / modeResults.length,
        overallPassRate: modeResults.filter((r) => r.overallPass).length / modeResults.length,
        avgRetrievalLatencyMs: Math.round(modeRetLatencies.reduce((s, v) => s + v, 0) / modeRetLatencies.length),
        p95RetrievalLatencyMs: percentile(modeRetLatencies, 95),
        avgTotalLatencyMs: Math.round(modeTotLatencies.reduce((s, v) => s + v, 0) / modeTotLatencies.length),
        p95TotalLatencyMs: percentile(modeTotLatencies, 95),
      };
    })
    .filter((s): s is ModeStats => s !== null);

  const overallPassRate = results.filter((r) => r.overallPass).length / results.length;
  const overallRetrieval = results.filter((r) => r.retrievalRelevant).length / results.length;
  const overallResponse = results.filter((r) => r.responseRelevant).length / results.length;

  // ─── Build report ───────────────────────────────────────────────────

  const report: EvalReport = {
    timestamp: new Date().toISOString(),
    totalTestCases: results.length,
    overallPassRate: Math.round(overallPassRate * 100) / 100,
    overallRetrievalPrecision: Math.round(overallRetrieval * 100) / 100,
    overallResponsePrecision: Math.round(overallResponse * 100) / 100,
    retrievalLatency: { p50Ms: retP50, p95Ms: retP95, maxMs: retMax, avgMs: retAvg },
    totalLatency: { p50Ms: totP50, p95Ms: totP95, maxMs: totMax, avgMs: totAvg },
    modeStats,
    details: results,
  };

  // ─── Print formatted report ─────────────────────────────────────────

  const W = 60;
  const line = "─".repeat(W);
  const dblLine = "═".repeat(W);

  console.log(`\n${dblLine}`);
  console.log("  EVALUATION SUITE REPORT");
  console.log(dblLine);
  console.log(`  Total test cases:        ${results.length}`);
  console.log(`  Overall pass rate:       ${(overallPassRate * 100).toFixed(0)}%`);
  console.log(`  Retrieval precision:     ${(overallRetrieval * 100).toFixed(0)}%`);
  console.log(`  Response precision:      ${(overallResponse * 100).toFixed(0)}%`);
  console.log(line);
  console.log("  RETRIEVAL LATENCY (embedding + search)");
  console.log(`  p50:                     ${retP50}ms`);
  console.log(`  p95:                     ${retP95}ms`);
  console.log(`  max:                     ${retMax}ms`);
  console.log(`  avg:                     ${retAvg}ms`);
  console.log(line);
  console.log("  TOTAL LATENCY (retrieval + LLM generation)");
  console.log(`  p50:                     ${totP50}ms`);
  console.log(`  p95:                     ${totP95}ms`);
  console.log(`  max:                     ${totMax}ms`);
  console.log(`  avg:                     ${totAvg}ms`);
  console.log(line);
  console.log("  PER-MODE BREAKDOWN");
  for (const ms of modeStats) {
    console.log(`  ${ms.mode.padEnd(18)} pass=${(ms.overallPassRate * 100).toFixed(0)}%  ret=${(ms.retrievalPrecision * 100).toFixed(0)}%  resp=${(ms.responsePrecision * 100).toFixed(0)}%  retP95=${ms.p95RetrievalLatencyMs}ms  totP95=${ms.p95TotalLatencyMs}ms  (n=${ms.testCases})`);
  }
  console.log(line);
  console.log("  TARGETS");
  const latencyPass = retP95 <= 3000;
  const retrievalPass = overallRetrieval >= 0.7;
  const passRatePass = overallPassRate >= 0.6;
  console.log(`  ${latencyPass ? "✓" : "✗"} retrievalLatencyP95: ${retP95}ms (target: ≤3000ms)`);
  console.log(`  ${retrievalPass ? "✓" : "✗"} retrievalPrecision: ${(overallRetrieval * 100).toFixed(0)}% (target: ≥70%)`);
  console.log(`  ${passRatePass ? "✓" : "✗"} overallPassRate: ${(overallPassRate * 100).toFixed(0)}% (target: ≥60%)`);
  console.log(`  ℹ totalLatencyP95: ${totP95}ms (informational — includes LLM generation)`);
  console.log(dblLine);

  // ─── Write JSON report ──────────────────────────────────────────────

  const reportsDir = resolve("reports");
  await mkdir(reportsDir, { recursive: true });
  const reportPath = resolve(reportsDir, "evaluation.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nReport saved to ${reportPath}\n`);

  // Exit with error if targets not met
  const allPassed = latencyPass && retrievalPass && passRatePass;
  if (!allPassed) {
    console.log("⚠ Some targets did not pass.\n");
    process.exit(1);
  }
}

evaluate().catch((err) => {
  console.error("Evaluation failed:", err);
  process.exit(1);
});
