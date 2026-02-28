"use client";

interface AnswerPanelProps {
  answer: string;
  isStreaming: boolean;
  title?: string;
}

export default function AnswerPanel({ answer, isStreaming, title }: AnswerPanelProps) {
  if (!answer && !isStreaming) return null;

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-700 dark:bg-zinc-900">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {title ?? "Answer"}
      </h2>
      <div className="prose prose-zinc max-w-none text-zinc-800 dark:prose-invert dark:text-zinc-200">
        {isStreaming && !answer ? (
          <div className="space-y-3">
            <div className="h-3 w-full animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
            <div className="h-3 w-[85%] animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
            <div className="h-3 w-[70%] animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
            <div className="h-3 w-[40%] animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
          </div>
        ) : (
          <>
            {answer.split("\n").map((line, i) => (
              <p key={i} className={line === "" ? "h-2" : ""}>
                {line}
              </p>
            ))}
            {isStreaming && (
              <span className="inline-block h-4 w-1.5 animate-pulse bg-blue-500" />
            )}
          </>
        )}
      </div>
    </div>
  );
}
