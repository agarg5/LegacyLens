import type { CodeChunk } from "../../src/lib/types";
import type { DiscoveredFile } from "./discover";

const MAX_CHUNK_SIZE = 1500; // characters — fits ~375 tokens
const OVERLAP_LINES = 3;

// COBOL structural patterns
const DIVISION_RE = /^\s*(IDENTIFICATION|ENVIRONMENT|DATA|PROCEDURE)\s+DIVISION/i;
const SECTION_RE = /^\s*([\w-]+)\s+SECTION\s*\.?\s*$/i;
const PARAGRAPH_RE = /^\s*([\w-]+)\s*\.\s*$/;
const PROGRAM_ID_RE = /^\s*PROGRAM-ID\.\s*([\w-]+)/i;

interface LineInfo {
  text: string;
  lineNumber: number; // 1-based
}

function isCommentLine(line: string): boolean {
  // Fixed-format: * in column 7 (index 6)
  if (line.length >= 7 && line[6] === "*") return true;
  // Free-format: *> anywhere
  if (line.trimStart().startsWith("*>")) return true;
  return false;
}

function extractProgramId(lines: LineInfo[]): string | undefined {
  for (const { text } of lines) {
    const match = text.match(PROGRAM_ID_RE);
    if (match) return match[1];
  }
  return undefined;
}

interface RawChunk {
  lines: LineInfo[];
  chunkType: CodeChunk["chunkType"];
  name: string;
  parentSection?: string;
}

function splitCobolStructurally(lines: LineInfo[]): RawChunk[] {
  const chunks: RawChunk[] = [];
  let currentChunk: LineInfo[] = [];
  let currentType: CodeChunk["chunkType"] = "division";
  let currentName = "PREAMBLE";
  let currentDivision = "";
  let currentSection = "";

  function flush() {
    if (currentChunk.length === 0) return;
    chunks.push({
      lines: [...currentChunk],
      chunkType: currentType,
      name: currentName,
      parentSection: currentSection || currentDivision || undefined,
    });
    currentChunk = [];
  }

  for (const line of lines) {
    const text = line.text;

    // Check for DIVISION boundary
    const divMatch = text.match(DIVISION_RE);
    if (divMatch) {
      flush();
      currentDivision = divMatch[1].toUpperCase() + " DIVISION";
      currentType = "division";
      currentName = currentDivision;
      currentSection = "";
      currentChunk.push(line);
      continue;
    }

    // Check for SECTION boundary
    const secMatch = text.match(SECTION_RE);
    if (secMatch && !isCommentLine(text)) {
      flush();
      currentSection = secMatch[1].toUpperCase();
      currentType = "section";
      currentName = currentSection;
      currentChunk.push(line);
      continue;
    }

    // Check for paragraph boundary (only in PROCEDURE DIVISION)
    if (
      currentDivision === "PROCEDURE DIVISION" &&
      !isCommentLine(text) &&
      text.trim().length > 0
    ) {
      const paraMatch = text.match(PARAGRAPH_RE);
      if (paraMatch && !text.match(/^\s*\d/)) {
        // Exclude level numbers (data items)
        flush();
        currentType = "paragraph";
        currentName = paraMatch[1].toUpperCase();
        currentChunk.push(line);
        continue;
      }
    }

    // Check for data division items at level 01 (major data groups)
    if (
      (currentDivision === "DATA DIVISION" || currentType === "data") &&
      text.match(/^\s*01\s+/i)
    ) {
      flush();
      currentType = "data";
      const nameMatch = text.match(/^\s*01\s+([\w-]+)/i);
      currentName = nameMatch ? nameMatch[1].toUpperCase() : "DATA-ITEM";
      currentChunk.push(line);
      continue;
    }

    currentChunk.push(line);
  }

  flush();
  return chunks;
}

function fixedSizeChunks(lines: LineInfo[]): LineInfo[][] {
  const result: LineInfo[][] = [];
  let i = 0;

  while (i < lines.length) {
    const chunkStartIdx = i;
    const chunk: LineInfo[] = [];
    let charCount = 0;

    while (i < lines.length && charCount < MAX_CHUNK_SIZE) {
      chunk.push(lines[i]);
      charCount += lines[i].text.length + 1;
      i++;
    }

    result.push(chunk);

    // Add overlap — back up by OVERLAP_LINES but not before one past the chunk start
    if (i < lines.length) {
      i = Math.max(i - OVERLAP_LINES, chunkStartIdx + 1);
    }
  }

  return result;
}

export function chunkFile(file: DiscoveredFile): CodeChunk[] {
  const lines: LineInfo[] = file.content.split("\n").map((text, i) => ({
    text,
    lineNumber: i + 1,
  }));

  const isCobol = [".cob", ".cbl", ".cpy"].includes(
    file.extension.toLowerCase()
  );
  const programId = isCobol ? extractProgramId(lines) : undefined;

  if (isCobol) {
    return chunkCobol(lines, file, programId);
  }

  // Non-COBOL: fixed-size chunking
  return chunkFixedSize(lines, file);
}

function chunkCobol(
  lines: LineInfo[],
  file: DiscoveredFile,
  programId?: string
): CodeChunk[] {
  const rawChunks = splitCobolStructurally(lines);
  const results: CodeChunk[] = [];

  for (const raw of rawChunks) {
    const content = raw.lines.map((l) => l.text).join("\n");

    // If chunk is too large, split further with fixed-size
    if (content.length > MAX_CHUNK_SIZE * 2) {
      const subChunks = fixedSizeChunks(raw.lines);
      for (let i = 0; i < subChunks.length; i++) {
        const sub = subChunks[i];
        results.push({
          id: makeId(file.filePath, sub[0].lineNumber),
          content: sub.map((l) => l.text).join("\n"),
          filePath: file.filePath,
          startLine: sub[0].lineNumber,
          endLine: sub[sub.length - 1].lineNumber,
          chunkType: raw.chunkType,
          name: subChunks.length > 1 ? `${raw.name} (part ${i + 1})` : raw.name,
          parentSection: raw.parentSection,
          programId,
        });
      }
    } else {
      results.push({
        id: makeId(file.filePath, raw.lines[0].lineNumber),
        content,
        filePath: file.filePath,
        startLine: raw.lines[0].lineNumber,
        endLine: raw.lines[raw.lines.length - 1].lineNumber,
        chunkType: raw.chunkType,
        name: raw.name,
        parentSection: raw.parentSection,
        programId,
      });
    }
  }

  return results;
}

function chunkFixedSize(
  lines: LineInfo[],
  file: DiscoveredFile
): CodeChunk[] {
  const subChunks = fixedSizeChunks(lines);
  return subChunks.map((sub, i) => ({
    id: makeId(file.filePath, sub[0].lineNumber),
    content: sub.map((l) => l.text).join("\n"),
    filePath: file.filePath,
    startLine: sub[0].lineNumber,
    endLine: sub[sub.length - 1].lineNumber,
    chunkType: "fixed" as const,
    name: `${file.filePath} (part ${i + 1})`,
    parentSection: undefined,
    programId: undefined,
  }));
}

function makeId(filePath: string, startLine: number): string {
  const safe = filePath.replace(/[^a-zA-Z0-9]/g, "_");
  return `${safe}_L${startLine}`;
}
