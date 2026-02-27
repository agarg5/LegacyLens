export interface CodeChunk {
  id: string;
  content: string;
  filePath: string;
  startLine: number;
  endLine: number;
  chunkType: "division" | "section" | "paragraph" | "data" | "fixed";
  name: string;
  parentSection?: string;
  programId?: string;
}

export interface SearchResult {
  chunk: CodeChunk;
  score: number;
}

export interface QueryResponse {
  answer: string;
  results: SearchResult[];
  latencyMs: number;
}

export type AnalysisMode = "explain" | "dependencies" | "documentation" | "business-logic";
