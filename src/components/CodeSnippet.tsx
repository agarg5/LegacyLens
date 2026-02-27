"use client";

import { useMemo } from "react";
import type { SearchResult } from "@/lib/types";

// COBOL keywords for syntax highlighting
const COBOL_KEYWORDS = new Set([
  "IDENTIFICATION", "DIVISION", "PROGRAM-ID", "ENVIRONMENT", "CONFIGURATION",
  "DATA", "WORKING-STORAGE", "SECTION", "PROCEDURE", "FILE", "FD", "SD",
  "COPY", "REPLACE", "PERFORM", "MOVE", "IF", "ELSE", "END-IF", "EVALUATE",
  "WHEN", "END-EVALUATE", "CALL", "USING", "RETURNING", "GO", "TO", "STOP",
  "RUN", "DISPLAY", "ACCEPT", "ADD", "SUBTRACT", "MULTIPLY", "DIVIDE",
  "COMPUTE", "READ", "WRITE", "REWRITE", "DELETE", "OPEN", "CLOSE",
  "START", "STRING", "UNSTRING", "INSPECT", "SEARCH", "SET", "INITIALIZE",
  "PIC", "PICTURE", "VALUE", "OCCURS", "REDEFINES", "FILLER", "COMP",
  "COMP-3", "COMP-5", "BINARY", "PACKED-DECIMAL", "USAGE", "INDEXED",
  "BY", "VARYING", "FROM", "UNTIL", "THRU", "THROUGH", "NOT", "AND", "OR",
  "EQUAL", "GREATER", "LESS", "THAN", "ZERO", "ZEROS", "ZEROES", "SPACE",
  "SPACES", "HIGH-VALUES", "LOW-VALUES", "QUOTES", "ALL", "TRUE", "FALSE",
  "SELECT", "ASSIGN", "ORGANIZATION", "ACCESS", "MODE", "SEQUENTIAL",
  "RANDOM", "DYNAMIC", "RELATIVE", "RECORD", "KEY", "STATUS", "INTO",
  "GIVING", "REMAINDER", "ON", "SIZE", "ERROR", "OVERFLOW", "AT", "END",
  "INVALID", "EXIT", "CONTINUE", "NEXT", "SENTENCE", "ALSO", "OTHER",
  "INPUT", "OUTPUT", "I-O", "EXTEND", "WITH", "ADVANCING", "AFTER",
  "BEFORE", "LINE", "PAGE", "UPON", "CORRESPONDING", "CORR",
]);

function highlightCobol(code: string): string {
  return code
    .split("\n")
    .map((line) => {
      // Comment lines (column 7 = *)
      if (/^.{6}\*/.test(line) || line.trimStart().startsWith("*>")) {
        return `<span class="hljs-comment">${escapeHtml(line)}</span>`;
      }

      // Highlight tokens
      return line.replace(/([A-Z][A-Z0-9-]*)|("(?:[^"\\]|\\.)*")|('(?:[^'\\]|\\.)*')|(\d+(?:\.\d+)?)/gi, (match, word, dblStr, sglStr, num) => {
        if (dblStr || sglStr) return `<span class="hljs-string">${escapeHtml(match)}</span>`;
        if (num) return `<span class="hljs-number">${escapeHtml(match)}</span>`;
        if (word && COBOL_KEYWORDS.has(word.toUpperCase())) {
          return `<span class="hljs-keyword">${escapeHtml(match)}</span>`;
        }
        return escapeHtml(match);
      });
    })
    .join("\n");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

interface CodeSnippetProps {
  result: SearchResult;
  index: number;
}

export default function CodeSnippet({ result, index }: CodeSnippetProps) {
  const { chunk, score } = result;

  const highlighted = useMemo(() => highlightCobol(chunk.content), [chunk.content]);

  const scorePercent = Math.round(score * 100);

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-zinc-100 px-4 py-2 dark:bg-zinc-800">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-mono font-medium text-zinc-700 dark:text-zinc-300">
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
        </div>
      </div>

      {/* Code */}
      <pre className="max-h-80 overflow-auto bg-zinc-50 p-4 text-sm leading-relaxed dark:bg-zinc-900/50">
        <code dangerouslySetInnerHTML={{ __html: highlighted }} />
      </pre>
    </div>
  );
}
