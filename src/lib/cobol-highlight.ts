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

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function highlightCobol(code: string): string {
  return code
    .split("\n")
    .map((line) => {
      // Comment lines (column 7 = *) — detect on raw line before escaping
      if (/^.{6}\*/.test(line) || line.trimStart().startsWith("*>")) {
        return `<span class="hljs-comment">${escapeHtml(line)}</span>`;
      }

      // Escape the full line first to prevent XSS via dangerouslySetInnerHTML,
      // then apply keyword/string/number highlighting on the safe output.
      const escaped = escapeHtml(line);
      return escaped.replace(/([A-Z][A-Z0-9-]*)|(&quot;(?:[^&]|&(?!quot;))*&quot;)|(&apos;(?:[^&]|&(?!apos;))*&apos;)|('(?:[^'\\]|\\.)*')|("(?:[^"\\]|\\.)*")|(\d+(?:\.\d+)?)/gi, (match, word, _dblEsc, _sglEsc, sglStr, dblStr, num) => {
        if (_dblEsc || _sglEsc || dblStr || sglStr) return `<span class="hljs-string">${match}</span>`;
        if (num) return `<span class="hljs-number">${match}</span>`;
        if (word && COBOL_KEYWORDS.has(word.toUpperCase())) {
          return `<span class="hljs-keyword">${match}</span>`;
        }
        return match;
      });
    })
    .join("\n");
}
