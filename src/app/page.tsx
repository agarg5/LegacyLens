"use client";

import { useState, useCallback } from "react";
import SearchInput from "@/components/SearchInput";
import CodeSnippet from "@/components/CodeSnippet";
import AnswerPanel from "@/components/AnswerPanel";
import ModeSelector from "@/components/ModeSelector";
import type { Mode } from "@/components/ModeSelector";
import type { SearchResult } from "@/lib/types";

const PLACEHOLDERS: Record<Mode, string> = {
  query: "Ask about the GnuCOBOL codebase...",
  explain: "Enter a program, section, or paragraph name to explain...",
  dependencies: "Enter a program or section to map dependencies...",
  documentation: "Enter a program or module to generate documentation...",
  "business-logic": "Enter a program or section to extract business rules...",
};

const ANSWER_TITLES: Record<Mode, string> = {
  query: "Answer",
  explain: "Explanation",
  dependencies: "Dependency Map",
  documentation: "Documentation",
  "business-logic": "Business Logic",
};

export default function Home() {
  const [mode, setMode] = useState<Mode>("query");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [answer, setAnswer] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = useCallback(async (query: string) => {
    setIsLoading(true);
    setIsStreaming(true);
    setResults([]);
    setAnswer("");
    setLatencyMs(null);
    setError(null);

    const start = Date.now();

    try {
      const isAnalyze = mode !== "query";
      const endpoint = isAnalyze ? "/api/analyze/stream" : "/api/query/stream";
      const body = isAnalyze ? { query, mode } : { query };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6);
          const event = JSON.parse(json);

          if (event.type === "sources") {
            setResults(event.results);
            setIsLoading(false);
          } else if (event.type === "token") {
            setAnswer((prev) => prev + event.content);
          } else if (event.type === "done") {
            setLatencyMs(Date.now() - start);
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setIsLoading(false);
      setIsStreaming(false);
    }
  }, [mode]);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="mx-auto max-w-4xl px-4 py-12">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            LegacyLens
          </h1>
          <p className="mt-2 text-zinc-500 dark:text-zinc-400">
            Ask questions about the GnuCOBOL codebase
          </p>
        </div>

        {/* Mode Selector */}
        <div className="mb-4">
          <ModeSelector mode={mode} onModeChange={setMode} />
        </div>

        {/* Search */}
        <div className="mb-8">
          <SearchInput
            onSearch={handleSearch}
            isLoading={isLoading}
            placeholder={PLACEHOLDERS[mode]}
          />
        </div>

        {/* Error */}
        {error && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Answer Panel */}
        {(answer || isStreaming) && (
          <div className="mb-8">
            <AnswerPanel
              answer={answer}
              isStreaming={isStreaming}
              title={ANSWER_TITLES[mode]}
            />
            {latencyMs !== null && (
              <p className="mt-2 text-right text-xs text-zinc-400">
                {(latencyMs / 1000).toFixed(1)}s end-to-end
              </p>
            )}
          </div>
        )}

        {/* Results */}
        {results.length > 0 && (
          <div>
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Source Chunks ({results.length})
            </h2>
            <div className="space-y-4">
              {results.map((r, i) => (
                <CodeSnippet key={r.chunk.id} result={r} index={i} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
