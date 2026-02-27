# LegacyLens RAG Architecture

## System Overview

LegacyLens is a Retrieval-Augmented Generation (RAG) system that makes legacy COBOL codebases queryable through natural language. It targets the **GnuCOBOL** compiler -- an open-source COBOL compiler with 100K+ lines of code across 50+ files (.cob, .cbl, .cpy, .c, .h). Users ask questions in plain English and receive cited, contextual answers grounded in the actual source code.

## Architecture Diagram

```
                         INGESTION (offline)
  ┌──────────┐    ┌───────────┐    ┌──────────────┐    ┌──────────┐
  │ GnuCOBOL │───>│ Discover  │───>│ COBOL-aware  │───>│ OpenAI   │
  │ Codebase  │    │ Files     │    │ Chunker      │    │ Embed    │
  └──────────┘    └───────────┘    └──────────────┘    └────┬─────┘
                                                            │
                                                            v
                                                      ┌──────────┐
                                                      │ Pinecone │
                                                      │ (vectors)│
                                                      └────┬─────┘
                                                           │
                        RETRIEVAL (online)                  │
  ┌──────┐    ┌──────────┐    ┌──────────┐    ┌───────────┐│
  │ User │───>│ Next.js  │───>│ Embed    │───>│ Similarity├┘
  │ Query│    │ API Route│    │ Query    │    │ Search    │
  └──────┘    └────┬─────┘    └──────────┘    └─────┬─────┘
                   │                                │
                   │         ┌──────────────┐       │
                   │         │ GPT-4o-mini  │<──────┘
                   │         │ (streaming)  │  top-k chunks
                   │         └──────┬───────┘
                   v                v
              ┌─────────────────────────┐
              │ SSE Stream: sources +   │
              │ cited answer to browser │
              └─────────────────────────┘
```

## Tech Stack

| Layer           | Choice                          | Rationale                                      |
|-----------------|---------------------------------|------------------------------------------------|
| Vector DB       | Pinecone (serverless, us-east-1)| Free tier, managed, cosine similarity, 1536-dim |
| Embeddings      | OpenAI text-embedding-3-small   | Good cost/quality balance at 1536 dimensions    |
| LLM             | GPT-4o-mini                     | Fast, inexpensive, strong instruction-following |
| Framework       | Custom pipeline (no LangChain)  | Full control, simpler debugging, interview-ready|
| Backend         | Next.js API routes (SSE)        | Full-stack in one framework, streaming support  |
| Frontend        | Next.js + React + Tailwind      | Single repo, syntax-highlighted UI              |
| Deployment      | Vercel                          | Zero-config, free tier, edge-ready              |
| Language        | TypeScript / Node.js            | End-to-end type safety                          |

## Ingestion Pipeline

The ingestion script (`scripts/ingest.ts`) runs offline in three stages:

1. **File Discovery** -- Recursively walks the GnuCOBOL source tree, collecting `.cob`, `.cbl`, `.cpy`, `.c`, and `.h` files with their contents and metadata.

2. **COBOL-Aware Chunking** -- COBOL files are split at structural boundaries using regex detection of DIVISION, SECTION, paragraph, and level-01 data item markers. Each chunk preserves:
   - `filePath`, `startLine`, `endLine` for precise citation
   - `chunkType` (division | section | paragraph | data | fixed)
   - `name` (e.g., "PROCEDURE DIVISION", "PROCESS-RECORD")
   - `parentSection` and `programId` for hierarchy context

   Oversized structural chunks (>3000 chars) are further split with fixed-size windowing (1500-char limit, 3-line overlap). Non-COBOL files use fixed-size chunking exclusively.

3. **Embedding and Upsert** -- Chunks are embedded in batches via OpenAI `text-embedding-3-small` (1536 dimensions) and upserted to Pinecone with all metadata fields stored alongside the vector.

## Retrieval Pipeline

Queries are handled by two SSE streaming API routes:

- **`/api/query/stream`** -- General Q&A about the codebase
- **`/api/analyze/stream`** -- Mode-specific analysis (see below)

Both follow the same three-step flow:

1. **Embed Query** -- The user's natural language query is embedded with the same model used during ingestion. Analysis modes prepend a `queryPrefix` (e.g., "CALL PERFORM COPY dependencies of") to bias retrieval toward mode-relevant chunks.

2. **Similarity Search** -- The query vector is sent to Pinecone with `topK` (default 5, up to 10 for dependency analysis). Returned matches include full chunk metadata.

3. **Streaming Answer Generation** -- Retrieved chunks are formatted into a numbered context block with file/line headers. GPT-4o-mini generates an answer via SSE streaming (temperature 0.2). The API emits three event types: `sources` (search results), `token` (streamed answer chunks), and `done`.

## Analysis Modes

Four specialized modes customize the retrieval and generation pipeline through per-mode system prompts, topK values, and query prefixes:

| Mode              | topK | Query Prefix                  | Focus                                         |
|-------------------|------|-------------------------------|-----------------------------------------------|
| **Explain**       | 5    | (none)                        | Plain-English code walkthrough, control flow   |
| **Dependencies**  | 10   | "CALL PERFORM COPY dependencies of" | CALL/PERFORM graphs, data items, copybooks |
| **Documentation** | 8    | "documentation overview of"   | Structured reference docs (inputs, outputs, flow) |
| **Business Logic**| 8    | "business rules conditions..." | IF/EVALUATE rules, calculations, validations  |

Each mode uses a detailed system prompt that instructs the LLM to produce structured output (numbered sections, markdown formatting) tailored to that analysis type.

## Performance

Evaluated across 14 test cases spanning all 5 modes (general + 4 analysis modes):

| Metric                | Target   | Actual   |
|-----------------------|----------|----------|
| Retrieval Precision   | >= 70%   | **100%** |
| Overall Pass Rate     | >= 60%   | **100%** |
| Retrieval Latency P95 | <= 3000ms| **~933ms** |
| Total Latency P95 (incl. LLM) | -- | ~4.5s |

The evaluation suite (`scripts/evaluate.ts`) checks both retrieval quality (file match + keyword match) and response quality (keyword checks in generated answers), with per-mode breakdowns and HTML/JSON report generation.

## Deployment

- **Platform**: Vercel (free tier)
- **Runtime**: Next.js API routes (Node.js serverless functions)
- **Streaming**: Server-Sent Events from API routes to the React frontend
- **Environment Variables**: `OPENAI_API_KEY`, `PINECONE_API_KEY`, `PINECONE_INDEX` configured in Vercel project settings
- **Ingestion**: Run locally via `npm run ingest` pointing at a local GnuCOBOL clone (batch process, not part of the deployed app)
