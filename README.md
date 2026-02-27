# LegacyLens

**RAG-powered natural language interface for legacy COBOL codebases.**

LegacyLens lets developers query legacy COBOL code using plain English. It ingests a codebase using syntax-aware chunking, stores embeddings in a vector database, and uses retrieval-augmented generation to answer questions with file and line number citations. Built as a custom pipeline without RAG frameworks for full control and transparency.

**Live demo:** [legacylens.vercel.app](https://legacylens.vercel.app)

## Features

- **Natural Language Search** -- Ask questions like "How does GnuCOBOL handle file I/O?" and get answers grounded in actual source code
- **COBOL-Aware Chunking** -- Syntax-aware splitting by COBOL divisions, sections, and paragraphs with fixed-size fallback for non-COBOL files
- **4 Analysis Modes** -- Beyond basic search, run specialized analyses:
  - **Code Explanation** -- Plain English walkthrough of control flow, COBOL constructs, and data dependencies
  - **Dependency Mapping** -- CALL/PERFORM graphs, data item flow, copybook and file dependencies
  - **Documentation Generation** -- Structured docs covering inputs, outputs, processing flow, and error handling
  - **Business Logic Extraction** -- Conditions, calculations, validations, and decision tables in business language
- **Streaming Responses** -- Server-sent events for real-time answer generation
- **Source Citations** -- Every answer references specific files and line numbers
- **File Context Panel** -- Click any source chunk to view surrounding code with syntax highlighting
- **Evaluation Suite** -- 14 test cases across 5 modes measuring retrieval precision, response quality, and latency

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend & Backend | Next.js 16 + React 19 + TypeScript |
| Styling | Tailwind CSS 4 |
| Vector Database | Pinecone (serverless, cosine similarity) |
| Embeddings | OpenAI `text-embedding-3-small` (1536 dimensions) |
| LLM | OpenAI `gpt-4o-mini` |
| Deployment | Vercel |

## Quick Start

### Prerequisites

- Node.js 18+
- npm
- An [OpenAI API key](https://platform.openai.com/api-keys)
- A [Pinecone account](https://www.pinecone.io/) (free tier works)

### Setup

```bash
# Clone the repository
git clone https://github.com/agarg5/LegacyLens.git
cd LegacyLens

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
```

Edit `.env.local` with your API keys:

```
OPENAI_API_KEY=sk-...
PINECONE_API_KEY=pcsk_...
PINECONE_INDEX=legacylens
```

### Create the Pinecone Index

```bash
npm run create-index
```

This creates a serverless Pinecone index with 1536 dimensions and cosine similarity. If the index already exists, it prints the current stats.

### Ingest a Codebase

Clone the target COBOL codebase and run ingestion:

```bash
# Clone GnuCOBOL (or any COBOL codebase)
git clone https://github.com/OCamlPro/gnucobol.git target-codebase

# Run the ingestion pipeline
npm run ingest
```

The ingestion pipeline will:
1. Discover all COBOL files (`.cob`, `.cbl`, `.cpy`) and other source files
2. Chunk them using syntax-aware splitting (divisions, sections, paragraphs) with fixed-size fallback
3. Embed all chunks using OpenAI and upsert to Pinecone

To ingest a codebase at a different path, set the `CODEBASE_ROOT` environment variable:

```bash
CODEBASE_ROOT=/path/to/cobol npm run ingest
```

### Start the Dev Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to start querying.

## Usage

1. **Select a mode** using the tabs at the top of the page:
   - **Query** -- General natural language questions about the codebase
   - **Explain** -- Detailed code explanations with control flow walkthroughs
   - **Dependencies** -- Map what calls what, data flow, and file dependencies
   - **Documentation** -- Generate structured technical documentation
   - **Business Logic** -- Extract business rules, conditions, and calculations

2. **Type your question** in the search bar and press Enter.

3. **Read the streamed answer** with file/line citations, then browse the source chunks below.

4. **Click any source chunk** to open the file context panel with surrounding code.

### Example Queries

| Mode | Example |
|------|---------|
| Query | "How does GnuCOBOL handle file I/O operations?" |
| Explain | "Explain the PROCEDURE DIVISION of cobxref.cob" |
| Dependencies | "What are the dependencies of the file I/O module?" |
| Documentation | "Generate documentation for the screen handling module" |
| Business Logic | "What business rules govern MOVE statement type conversions?" |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start the Next.js development server |
| `npm run build` | Production build |
| `npm run start` | Start the production server |
| `npm run lint` | Run ESLint |
| `npm run create-index` | Create the Pinecone vector index |
| `npm run ingest` | Ingest a COBOL codebase into Pinecone |
| `npm run ingest:benchmark` | Wipe index and re-ingest with timing report |
| `npm run validate` | Run retrieval-only validation (12 Q&A pairs) |
| `npm run evaluate` | Run full evaluation suite (14 test cases, 5 modes) |

## Project Structure

```
LegacyLens/
├── src/
│   ├── app/
│   │   ├── page.tsx                  # Main UI page
│   │   └── api/
│   │       ├── query/                # General search + answer generation
│   │       ├── analyze/              # Analysis modes (explain, deps, docs, biz logic)
│   │       ├── search/               # Retrieval-only endpoint
│   │       ├── file-context/         # File context for slide-over panel
│   │       └── ingest/               # Ingestion API route
│   ├── components/
│   │   ├── SearchInput.tsx           # Query input with mode-aware placeholders
│   │   ├── ModeSelector.tsx          # Analysis mode tabs
│   │   ├── AnswerPanel.tsx           # Streaming markdown answer display
│   │   ├── CodeSnippet.tsx           # Source chunk cards with syntax highlighting
│   │   └── FileContextPanel.tsx      # Slide-over panel for full file context
│   └── lib/
│       ├── types.ts                  # CodeChunk, SearchResult, QueryResponse, AnalysisMode
│       ├── openai.ts                 # OpenAI client + model constants
│       ├── pinecone.ts               # Pinecone client + index helper
│       ├── retrieval.ts              # Embedding + similarity search
│       ├── prompts.ts                # System prompts for each analysis mode
│       └── cobol-highlight.ts        # COBOL syntax highlighting
├── scripts/
│   ├── create-index.ts               # Pinecone index creation
│   ├── ingest.ts                     # Ingestion pipeline entry point
│   ├── benchmark.ts                  # Ingestion benchmark with timing
│   ├── validate.ts                   # Retrieval-only validation
│   ├── evaluate.ts                   # Full evaluation suite
│   └── lib/
│       ├── discover.ts               # File discovery (COBOL + general)
│       ├── chunker.ts                # Syntax-aware + fixed-size chunking
│       └── embedder.ts               # Embedding + Pinecone upsert
├── reports/                          # Generated eval reports (JSON + HTML)
├── .env.example                      # Required environment variables
└── package.json
```

## Performance

### Targets

| Metric | Target | Description |
|--------|--------|-------------|
| Retrieval Latency (P95) | < 3 seconds | Embedding + Pinecone search |
| Retrieval Precision | > 70% | Relevant chunks in top-k results |
| Overall Pass Rate | > 60% | Retrieval + response quality combined |
| Codebase Coverage | 100% | All files indexed |
| Ingestion Throughput | 10,000+ LOC in < 5 min | Full pipeline including embedding |

Run `npm run evaluate` to generate a detailed HTML report with per-mode breakdowns in `reports/evaluation.html`.

## Deployment

LegacyLens is configured for one-click deployment on Vercel.

1. Push the repository to GitHub.
2. Import the project in [Vercel](https://vercel.com/new).
3. Add the following environment variables in Vercel project settings:
   - `OPENAI_API_KEY`
   - `PINECONE_API_KEY`
   - `PINECONE_INDEX`
4. Deploy.

The deployed application uses the same Pinecone index, so make sure the codebase has been ingested before querying.

## License

MIT
