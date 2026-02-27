"use client";

import type { AnalysisMode } from "@/lib/types";

export type Mode = "query" | AnalysisMode;

interface ModeSelectorProps {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
}

const MODES: { value: Mode; label: string; description: string }[] = [
  { value: "query", label: "General Query", description: "Ask any question about the codebase" },
  { value: "explain", label: "Explain Code", description: "Plain English code explanation" },
  { value: "dependencies", label: "Dependencies", description: "Map calls, data flow, and copybooks" },
  { value: "documentation", label: "Generate Docs", description: "Structured documentation" },
  { value: "business-logic", label: "Business Logic", description: "Extract business rules" },
];

export default function ModeSelector({ mode, onModeChange }: ModeSelectorProps) {
  return (
    <div className="flex flex-wrap justify-center gap-2">
      {MODES.map((m) => (
        <button
          key={m.value}
          onClick={() => onModeChange(m.value)}
          className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors sm:px-4 sm:text-sm ${
            mode === m.value
              ? "bg-blue-600 text-white"
              : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
          }`}
          title={m.description}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
