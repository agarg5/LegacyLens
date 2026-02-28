import type { Mode } from "@/components/ModeSelector";

const MODE_LABELS: Record<Mode, string> = {
  query: "General Query",
  explain: "Explain Code",
  dependencies: "Dependencies",
  documentation: "Generate Docs",
  "business-logic": "Business Logic",
};

interface QuestionDisplayProps {
  query: string;
  mode: Mode;
}

export default function QuestionDisplay({ query, mode }: QuestionDisplayProps) {
  return (
    <div className="flex items-start gap-3">
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
        {query}
      </h2>
      {mode !== "query" && (
        <span className="mt-0.5 shrink-0 rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
          {MODE_LABELS[mode]}
        </span>
      )}
    </div>
  );
}
