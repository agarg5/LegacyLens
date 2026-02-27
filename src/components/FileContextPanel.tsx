"use client";

import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { highlightCobol } from "@/lib/cobol-highlight";
import type { CodeChunk } from "@/lib/types";

interface FileContextPanelProps {
  filePath: string;
  highlightChunkId: string;
  onClose: () => void;
}

export default function FileContextPanel({
  filePath,
  highlightChunkId,
  onClose,
}: FileContextPanelProps) {
  const [chunks, setChunks] = useState<CodeChunk[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const highlightRef = useRef<HTMLDivElement>(null);

  // Fetch file context chunks
  useEffect(() => {
    let cancelled = false;

    async function fetchContext() {
      try {
        const res = await fetch("/api/file-context", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filePath }),
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) setChunks(data.chunks);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchContext();
    return () => { cancelled = true; };
  }, [filePath]);

  // Trigger slide-in animation
  useEffect(() => {
    requestAnimationFrame(() => setOpen(true));
  }, []);

  // Lock body scroll while open
  useEffect(() => {
    document.body.classList.add("overflow-hidden");
    return () => document.body.classList.remove("overflow-hidden");
  }, []);

  // Scroll highlighted chunk into view once loaded
  useEffect(() => {
    if (!loading && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [loading]);

  // Close with animation
  const handleClose = useCallback(() => {
    setOpen(false);
    setTimeout(onClose, 300);
  }, [onClose]);

  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black transition-opacity duration-300 ${
          open ? "opacity-30" : "opacity-0"
        }`}
        onClick={handleClose}
      />

      {/* Panel */}
      <div
        className={`relative flex w-full flex-col bg-white shadow-2xl transition-transform duration-300 sm:max-w-2xl dark:bg-zinc-900 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-700">
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-mono text-sm font-semibold text-zinc-800 dark:text-zinc-200">
              {filePath}
            </h2>
            {!loading && (
              <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                {chunks.length} chunk{chunks.length !== 1 ? "s" : ""} in file
              </p>
            )}
          </div>
          <button
            onClick={handleClose}
            className="ml-4 rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading && (
            <div className="flex items-center justify-center py-12 text-sm text-zinc-500">
              Loading file context...
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
              {error}
            </div>
          )}

          {!loading && !error && chunks.length === 0 && (
            <div className="py-12 text-center text-sm text-zinc-500">
              No chunks found for this file.
            </div>
          )}

          {!loading && !error && chunks.map((chunk, i) => (
            <ChunkBlock
              key={chunk.id}
              chunk={chunk}
              isHighlighted={chunk.id === highlightChunkId}
              ref={chunk.id === highlightChunkId ? highlightRef : undefined}
              prevEndLine={i > 0 ? chunks[i - 1].endLine : undefined}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

import { forwardRef } from "react";

interface ChunkBlockProps {
  chunk: CodeChunk;
  isHighlighted: boolean;
  prevEndLine?: number;
}

const ChunkBlock = forwardRef<HTMLDivElement, ChunkBlockProps>(
  function ChunkBlock({ chunk, isHighlighted, prevEndLine }, ref) {
    const highlighted = useMemo(() => highlightCobol(chunk.content), [chunk.content]);

    const hasGap = prevEndLine !== undefined && chunk.startLine > prevEndLine + 1;

    return (
      <>
        {hasGap && (
          <div className="flex items-center justify-center py-2 text-xs text-zinc-400 dark:text-zinc-600">
            <span className="rounded bg-zinc-100 px-3 py-0.5 font-mono dark:bg-zinc-800">
              ··· lines {prevEndLine! + 1}&ndash;{chunk.startLine - 1} ···
            </span>
          </div>
        )}
        <div
          ref={ref}
          className={`mb-3 overflow-hidden rounded-lg border ${
            isHighlighted
              ? "border-l-4 border-blue-500 bg-blue-50/50 dark:bg-blue-950/20"
              : "border-zinc-200 dark:border-zinc-700"
          }`}
        >
          {/* Chunk header */}
          <div className="flex items-center gap-2 bg-zinc-100 px-3 py-1.5 text-xs dark:bg-zinc-800">
            <span className="rounded bg-blue-100 px-1.5 py-0.5 font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
              {chunk.chunkType}
            </span>
            {chunk.name && (
              <span className="font-medium text-zinc-600 dark:text-zinc-300">
                {chunk.name}
              </span>
            )}
            <span className="ml-auto text-zinc-400 dark:text-zinc-500">
              L{chunk.startLine}&ndash;{chunk.endLine}
            </span>
          </div>

          {/* Code */}
          <pre className="overflow-auto bg-zinc-50 p-3 text-xs leading-relaxed dark:bg-zinc-900/50">
            <code dangerouslySetInnerHTML={{ __html: highlighted }} />
          </pre>
        </div>
      </>
    );
  }
);
