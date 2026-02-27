# LegacyLens

RAG-powered system for querying legacy COBOL codebases through natural language.

Ask questions like *"Where is the main entry point?"* or *"What functions modify the CUSTOMER-RECORD?"* and get relevant code snippets with explanations.

## Architecture

| Component | Technology |
|-----------|-----------|
| Target Codebase | GnuCOBOL (COBOL compiler) |
| Vector Database | Pinecone |
| Embeddings | OpenAI text-embedding-3-small (1536 dims) |
| LLM | GPT-4o-mini |
| Frontend + Backend | Next.js (TypeScript) |
| Deployment | Vercel |

## Getting Started

### Prerequisites

- Node.js 18+
- OpenAI API key
- Pinecone API key and index

### Setup

```bash
# Clone the repo
git clone https://github.com/agarg5/LegacyLens.git
cd LegacyLens

# Install dependencies
npm install

# Copy environment variables
cp .env.example .env
# Edit .env with your API keys

# Run the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to use the app.

### Ingesting a Codebase

```bash
# Clone the target codebase
git clone https://github.com/OCamlPro/gnucobol.git target-codebase

# Run the ingestion pipeline
npm run ingest
```

### Running the Performance Benchmark

```bash
npm run ingest:benchmark
```

This will wipe the index, re-ingest from scratch, and output a timing report.

## Features

- **Semantic Search** — Find relevant code using natural language queries
- **Code Explanation** — Get plain English explanations of COBOL functions and paragraphs
- **Dependency Mapping** — See what calls what and data flow between modules
- **Documentation Generation** — Auto-generate docs for undocumented code
- **Business Logic Extraction** — Identify and explain business rules in code

## Deployed Application

[https://legacylens.vercel.app](https://legacylens.vercel.app)
