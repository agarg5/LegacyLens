# LegacyLens - RAG System for Legacy Enterprise Codebases

## Project Overview
Build a RAG-powered system that makes legacy codebases queryable through natural language. One-week sprint for Gauntlet AI program.

## Architectural Decisions

### Target Codebase
- **GnuCOBOL** (COBOL) — Open source COBOL compiler
- Rich syntax structure (divisions, sections, paragraphs) makes chunking more interesting
- Well over 10,000 LOC across 50+ files

### Tech Stack
| Layer | Choice | Rationale |
|-------|--------|-----------|
| Vector Database | **Pinecone** (managed cloud) | Free tier, simple API, existing account |
| Embedding Model | **OpenAI text-embedding-3-small** (1536 dims) | Good cost/quality balance, existing credits |
| LLM | **GPT-4o-mini** (answer gen) | Fast, cheap, existing credits |
| Framework | **Custom pipeline** (no LangChain) | Simpler, full control, better for interviews |
| Backend | **Next.js API routes** | Full-stack in one framework |
| Frontend | **Next.js + React** | One repo, one deployment |
| Deployment | **Vercel** | One-click deploy, free tier |
| Language | **TypeScript/Node.js** | Developer preference |

### Chunking Strategy
- **Primary**: Syntax-aware splitting (COBOL divisions, sections, paragraphs)
- **Fallback**: Fixed-size + overlap for unstructured sections
- Preserve metadata: file path, line numbers, function/paragraph names, dependencies

### Retrieval Pipeline
1. Parse natural language query
2. Embed query with same model (text-embedding-3-small)
3. Similarity search in Pinecone (top-k = 5-10)
4. Assemble context from retrieved chunks
5. LLM generates answer with file/line references

### Performance Targets
- Query latency: <3 seconds end-to-end
- Retrieval precision: >70% relevant chunks in top-5
- Codebase coverage: 100% of files indexed
- Ingestion throughput: 10,000+ LOC in <5 minutes

## Deadlines
- **MVP**: Tuesday (24 hours) — Basic RAG pipeline working
- **Early Submission**: Friday (4 days) — Full feature set
- **Final**: Sunday (7 days) — Polish, docs, deployment

## Deliverables
- [ ] GitHub Repository with setup guide
- [ ] Demo Video (3-5 min)
- [ ] Pre-Search Document (HTML)
- [ ] RAG Architecture Doc (1-2 pages)
- [ ] AI Cost Analysis
- [ ] Deployed Application (Vercel)
- [ ] Social Post

## Development Notes
- Target codebase (GnuCOBOL) lives OUTSIDE this repo — ingestion script points at a local clone
- MVP = batch ingestion only (no incremental updates)
- Eval: 10-15 hand-crafted Q&A pairs to measure retrieval precision
- Use LangSmith for observability if needed (account exists)
