"use client";

import { useMemo } from "react";
import { highlightCobol } from "@/lib/cobol-highlight";
import type { SearchResult } from "@/lib/types";

interface CodeSnippetProps {
  result: SearchResult;
  index: number;
  onClick?: (result: SearchResult) => void;
}

export default function CodeSnippet({ result, index, onClick }: CodeSnippetProps) {
  const { chunk, score } = result;

  const highlighted = useMemo(() => highlightCobol(chunk.content), [chunk.content]);

  const scorePercent = Math.round(score * 100);

  return (
    <div
      className={`overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700 ${
        onClick
          ? "cursor-pointer transition-all hover:border-blue-400 hover:shadow-md"
          : ""
      }`}
      onClick={onClick ? () => onClick(result) : undefined}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-zinc-100 px-4 py-2 dark:bg-zinc-800">
        <div className="flex items-center gap-2 text-xs sm:text-sm">
          <span className="max-w-[200px] truncate font-mono font-medium text-zinc-700 sm:max-w-none dark:text-zinc-300">
            [{index + 1}] {chunk.filePath}
          </span>
          <span className="text-zinc-400">:</span>
          <span className="text-zinc-500 dark:text-zinc-400">
            L{chunk.startLine}&ndash;{chunk.endLine}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="rounded bg-blue-100 px-2 py-0.5 font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
            {chunk.chunkType}
          </span>
          {chunk.name && (
            <span className="text-zinc-500 dark:text-zinc-400">{chunk.name}</span>
          )}
          <span
            className={`font-mono ${scorePercent >= 70 ? "text-green-600 dark:text-green-400" : "text-zinc-500 dark:text-zinc-400"}`}
          >
            {scorePercent}%
          </span>
          {onClick && (
            <span className="hidden text-blue-500 sm:inline dark:text-blue-400">
              View file &rarr;
            </span>
          )}
        </div>
      </div>

      {/* Code */}
      <pre className="max-h-80 overflow-auto bg-zinc-50 p-4 text-xs leading-relaxed sm:text-sm dark:bg-zinc-900/50">
        <code dangerouslySetInnerHTML={{ __html: highlighted }} />
      </pre>
    </div>
  );
}
