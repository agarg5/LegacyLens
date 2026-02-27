import { readdir, readFile, stat } from "fs/promises";
import { join, extname, relative } from "path";

export interface DiscoveredFile {
  filePath: string; // relative to codebase root
  absolutePath: string;
  extension: string;
  content: string;
  lineCount: number;
}

const COBOL_EXTENSIONS = new Set([
  ".cob",
  ".cbl",
  ".cpy",
  ".cobcopy",
]);

const SOURCE_EXTENSIONS = new Set([
  ...COBOL_EXTENSIONS,
  ".c",
  ".h",
  ".y",
  ".l",
  ".def",
  ".conf",
  ".words",
]);

function isCobolFile(ext: string): boolean {
  return COBOL_EXTENSIONS.has(ext.toLowerCase());
}

function isSourceFile(ext: string): boolean {
  return SOURCE_EXTENSIONS.has(ext.toLowerCase());
}

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "build_aux",
  "build_windows",
  "po",
  "m4",
  ".worktrees",
]);

async function walkDir(
  dir: string,
  rootDir: string,
  filter: (ext: string) => boolean
): Promise<DiscoveredFile[]> {
  const results: DiscoveredFile[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const subResults = await walkDir(fullPath, rootDir, filter);
      results.push(...subResults);
    } else if (entry.isFile()) {
      const ext = extname(entry.name).toLowerCase();
      if (!filter(ext)) continue;

      const fileStat = await stat(fullPath);
      if (fileStat.size > 1_000_000) continue; // skip files >1MB

      const content = await readFile(fullPath, "utf-8");
      results.push({
        filePath: relative(rootDir, fullPath),
        absolutePath: fullPath,
        extension: ext,
        content,
        lineCount: content.split("\n").length,
      });
    }
  }

  return results;
}

export async function discoverFiles(
  codebaseRoot: string,
  options: { cobolOnly?: boolean } = {}
): Promise<DiscoveredFile[]> {
  const filter = options.cobolOnly ? isCobolFile : isSourceFile;
  const files = await walkDir(codebaseRoot, codebaseRoot, filter);

  console.log(`Discovered ${files.length} files:`);
  const byExt = new Map<string, number>();
  let totalLines = 0;
  for (const f of files) {
    byExt.set(f.extension, (byExt.get(f.extension) || 0) + 1);
    totalLines += f.lineCount;
  }
  for (const [ext, count] of [...byExt.entries()].sort()) {
    console.log(`  ${ext}: ${count} files`);
  }
  console.log(`  Total: ${totalLines} lines`);

  return files;
}
