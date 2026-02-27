import * as dotenv from "dotenv";
import { resolve } from "path";
import { mkdir, writeFile } from "fs/promises";
import { searchChunks } from "../src/lib/retrieval";
import { openai, CHAT_MODEL } from "../src/lib/openai";
import type { SearchResult } from "../src/lib/types";

dotenv.config({ path: ".env.local" });

// ─── Analysis mode types (mirrors src/lib/types.ts once merged) ──────────

type AnalysisMode = "explain" | "dependencies" | "documentation" | "business-logic";
type EvalMode = "general" | AnalysisMode;

interface ModeConfig {
  systemPrompt: string;
  defaultTopK: number;
  queryPrefix?: string;
}

// Inline mode configs so the eval suite works before the analyze feature merges.
// These mirror what src/lib/prompts.ts will export.
const MODE_CONFIGS: Record<AnalysisMode, ModeConfig> = {
  explain: {
    defaultTopK: 5,
    systemPrompt: `You are a legacy code expert. Provide a detailed, step-by-step explanation of the retrieved COBOL code.
Break down what each section does, explain control flow, data movement, and any side effects.
Always cite file paths and line numbers. If the code is incomplete, note what's missing.`,
  },
  dependencies: {
    defaultTopK: 10,
    queryPrefix: "CALL PERFORM COPY dependencies of",
    systemPrompt: `You are a legacy code expert. Analyze the retrieved code and map all dependencies:
- CALL statements (external program calls)
- PERFORM statements (internal paragraph/section calls)
- COPY/COPYBOOK references
- Data dependencies (shared data items, file descriptors)
Present the results as a structured dependency map. Always cite file paths and line numbers.`,
  },
  documentation: {
    defaultTopK: 8,
    queryPrefix: "documentation overview of",
    systemPrompt: `You are a legacy code expert. Generate structured documentation for the retrieved code:
- Purpose and overview
- Input/output parameters and data items
- Business logic summary
- Key operations and control flow
- Dependencies and external references
Use clear headings and always cite file paths and line numbers.`,
  },
  "business-logic": {
    defaultTopK: 8,
    queryPrefix: "business rules conditions calculations in",
    systemPrompt: `You are a legacy code expert. Extract and explain business rules from the retrieved code:
- Conditional logic (IF/EVALUATE/WHEN)
- Calculations and formulas (COMPUTE, ADD, SUBTRACT, etc.)
- Validation rules and constraints
- Data transformation rules
Present each rule clearly with its purpose. Always cite file paths and line numbers.`,
  },
};

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
  latencyMs: number;
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
  avgLatencyMs: number;
  p95LatencyMs: number;
}

interface EvalReport {
  timestamp: string;
  totalTestCases: number;
  overallPassRate: number;
  overallRetrievalPrecision: number;
  overallResponsePrecision: number;
  latency: {
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

  const results: EvalResult[] = [];

  for (const tc of TEST_CASES) {
    const modeConfig = tc.mode !== "general" ? MODE_CONFIGS[tc.mode] : null;
    const topK = modeConfig?.defaultTopK ?? 5;

    // Build the search query (with optional prefix for analysis modes)
    const searchQuery = modeConfig?.queryPrefix
      ? `${modeConfig.queryPrefix} ${tc.query}`
      : tc.query;

    // 1. Retrieval
    const start = Date.now();
    const searchResults = await searchChunks(searchQuery, topK);

    // 2. Generation
    const answer = await generateWithMode(tc.query, searchResults, tc.mode);
    const latencyMs = Date.now() - start;

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

    results.push({
      mode: tc.mode,
      description: tc.description,
      query: tc.query,
      latencyMs,
      retrievedFiles,
      fileMatch,
      keywordMatch,
      responseChecksPassed: checksPassedCount,
      responseChecksTotal: tc.responseChecks.length,
      topScore,
      retrievalRelevant,
      responseRelevant,
      overallPass,
    });

    const icon = overallPass ? "✓" : "✗";
    const modeTag = `[${tc.mode}]`.padEnd(17);
    console.log(`  ${icon} ${modeTag} [${latencyMs}ms] ${tc.description}`);
    if (!overallPass) {
      console.log(`    retrieval=${retrievalRelevant} response=${responseRelevant} (${checksPassedCount}/${tc.responseChecks.length} checks)`);
      if (!retrievalRelevant) {
        console.log(`    files: ${retrievedFiles.join(", ")}`);
      }
    }
  }

  // ─── Compute stats ──────────────────────────────────────────────────

  // Overall latency
  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);
  const max = latencies[latencies.length - 1];
  const avg = Math.round(latencies.reduce((s, v) => s + v, 0) / latencies.length);

  // Per-mode stats
  const modes: EvalMode[] = ["general", "explain", "dependencies", "documentation", "business-logic"];
  const modeStats: ModeStats[] = modes
    .map((mode) => {
      const modeResults = results.filter((r) => r.mode === mode);
      if (modeResults.length === 0) return null;
      const modeLatencies = modeResults.map((r) => r.latencyMs).sort((a, b) => a - b);
      return {
        mode,
        testCases: modeResults.length,
        retrievalPrecision: modeResults.filter((r) => r.retrievalRelevant).length / modeResults.length,
        responsePrecision: modeResults.filter((r) => r.responseRelevant).length / modeResults.length,
        overallPassRate: modeResults.filter((r) => r.overallPass).length / modeResults.length,
        avgLatencyMs: Math.round(modeLatencies.reduce((s, v) => s + v, 0) / modeLatencies.length),
        p95LatencyMs: percentile(modeLatencies, 95),
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
    latency: { p50Ms: p50, p95Ms: p95, maxMs: max, avgMs: avg },
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
  console.log("  LATENCY");
  console.log(`  p50:                     ${p50}ms`);
  console.log(`  p95:                     ${p95}ms`);
  console.log(`  max:                     ${max}ms`);
  console.log(`  avg:                     ${avg}ms`);
  console.log(line);
  console.log("  PER-MODE BREAKDOWN");
  for (const ms of modeStats) {
    console.log(`  ${ms.mode.padEnd(18)} pass=${(ms.overallPassRate * 100).toFixed(0)}%  retrieval=${(ms.retrievalPrecision * 100).toFixed(0)}%  response=${(ms.responsePrecision * 100).toFixed(0)}%  p95=${ms.p95LatencyMs}ms  (n=${ms.testCases})`);
  }
  console.log(line);
  console.log("  TARGETS");
  const latencyPass = p95 <= 3000;
  const retrievalPass = overallRetrieval >= 0.7;
  const passRatePass = overallPassRate >= 0.6;
  console.log(`  ${latencyPass ? "✓" : "✗"} queryLatencyP95: ${p95}ms (target: ≤3000ms)`);
  console.log(`  ${retrievalPass ? "✓" : "✗"} retrievalPrecision: ${(overallRetrieval * 100).toFixed(0)}% (target: ≥70%)`);
  console.log(`  ${passRatePass ? "✓" : "✗"} overallPassRate: ${(overallPassRate * 100).toFixed(0)}% (target: ≥60%)`);
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
