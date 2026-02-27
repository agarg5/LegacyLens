# LegacyLens AI Cost Analysis

## Summary

LegacyLens uses OpenAI APIs (text-embedding-3-small for embeddings, GPT-4o-mini for answer generation) and Pinecone (free tier) for vector storage. Total development cost is under $0.50, and per-query cost averages $0.0004-$0.001 depending on the analysis mode. At moderate production volumes (1,000 queries/day), the system costs roughly $0.50-$1.00/day.

| Category | Estimated Cost |
|----------|---------------|
| One-time ingestion (full codebase) | ~$0.015 |
| Per query (average) | ~$0.0006 |
| Evaluation suite (14 tests, one run) | ~$0.009 |
| Infrastructure (Pinecone + Vercel) | $0 (free tiers) |
| **Total development cost (est.)** | **< $0.50** |

---

## 1. Ingestion Costs

### Codebase Profile

- **Target**: GnuCOBOL compiler -- well over 10,000 lines of code across 50+ files
- **Chunking strategy**: Syntax-aware (COBOL divisions/sections/paragraphs) with fixed-size fallback
- **Max chunk size**: 1,500 characters (~375 tokens per chunk)
- **Estimated chunks**: ~2,000 (structural COBOL chunks + fixed-size chunks for non-COBOL files)

### Token Estimation

The embedder estimates tokens as `Math.ceil(text.length / 4)` per chunk. Each chunk includes metadata headers (program ID, section name, file path) prepended to the content.

| Metric | Estimate |
|--------|----------|
| Total chunks | ~2,000 |
| Avg tokens per chunk (content + metadata) | ~400 |
| **Total embedding tokens** | **~800,000** |

### Embedding API Cost

- **Model**: `text-embedding-3-small` (1536 dimensions)
- **Price**: $0.020 per 1M tokens
- **Batch size**: 100 chunks per API call (~20 API calls total)

```
800,000 tokens x $0.020 / 1,000,000 = $0.016
```

**One-time ingestion cost: ~$0.016**

Re-ingestion (e.g., after codebase updates) costs the same amount each time. There is no incremental indexing -- each run re-embeds the full codebase.

---

## 2. Query Costs

Each query involves two API calls:

1. **Embedding call** -- embed the user's query (same model as ingestion)
2. **LLM call** -- generate an answer from retrieved chunks (GPT-4o-mini)

### Embedding Cost per Query

A typical query is 10-30 tokens. Cost is negligible:

```
~25 tokens x $0.020 / 1,000,000 = $0.0000005
```

### LLM Cost per Query

The LLM input consists of a system prompt + retrieved code chunks + user question. Token counts vary by analysis mode due to different `topK` values and system prompt lengths.

| Mode | topK | System Prompt (tokens) | Context per chunk (tokens) | Est. Input Tokens | Est. Output Tokens |
|------|------|----------------------|---------------------------|-------------------|-------------------|
| General (search) | 5 | ~80 | ~375 | ~2,000 | ~400 |
| Explain | 5 | ~130 | ~375 | ~2,100 | ~500 |
| Dependencies | 10 | ~150 | ~375 | ~4,000 | ~500 |
| Documentation | 8 | ~170 | ~375 | ~3,300 | ~600 |
| Business Logic | 8 | ~170 | ~375 | ~3,300 | ~600 |

**Average per-query LLM cost** (using General as the most common mode):

```
Input:  2,000 tokens x $0.15 / 1,000,000 = $0.0003
Output:   400 tokens x $0.60 / 1,000,000 = $0.00024
Total LLM cost per query:                  $0.00054
```

**Weighted average across all modes: ~$0.0006 per query**

### Total Cost per Query

| Component | Cost |
|-----------|------|
| Query embedding | $0.0000005 |
| LLM generation | $0.0003 - $0.001 |
| Pinecone search | $0 (free tier) |
| **Total per query** | **~$0.0004 - $0.001** |

---

## 3. Evaluation Costs

The evaluation suite (`scripts/evaluate.ts`) runs 14 test cases across 5 modes. Each test case makes 1 embedding call + 1 LLM call.

| Component | Calculation | Cost |
|-----------|------------|------|
| 14 embedding calls | 14 x ~30 tokens x $0.020/1M | $0.000008 |
| 14 LLM calls (input) | 14 x ~3,000 avg tokens x $0.15/1M | $0.0063 |
| 14 LLM calls (output) | 14 x ~500 avg tokens x $0.60/1M | $0.0042 |
| **Total per eval run** | | **~$0.009** |

Running the eval suite 10 times during development: ~$0.09.

---

## 4. Infrastructure Costs

| Service | Tier | Monthly Cost | Notes |
|---------|------|-------------|-------|
| **Pinecone** | Free (Starter) | $0 | Serverless, us-east-1, up to 2GB storage, unlimited reads |
| **Vercel** | Hobby (Free) | $0 | Next.js hosting, serverless functions, 100GB bandwidth |
| **OpenAI** | Pay-as-you-go | Variable | See query costs above |
| **GitHub** | Free | $0 | Source control |
| **Total infra** | | **$0/month** | (excluding API usage) |

### Pinecone Storage

- ~2,000 vectors x 1536 dimensions x 4 bytes = ~12 MB
- Well within the 2GB free tier limit
- Could store ~160x more vectors before hitting the limit

---

## 5. Scaling Projections

| Daily Queries | Monthly Queries | Monthly API Cost | Annualized |
|--------------|----------------|-----------------|------------|
| 10 | 300 | $0.18 | $2.16 |
| 100 | 3,000 | $1.80 | $21.60 |
| 1,000 | 30,000 | $18.00 | $216.00 |
| 10,000 | 300,000 | $180.00 | $2,160.00 |

**Assumptions**: Average cost of $0.0006 per query, uniform mode distribution. Pinecone free tier supports all volume levels above (read-heavy workload with no write overhead after initial ingestion).

### Tier Thresholds

- **Free tier viable**: Up to ~1,000 queries/day ($18/month in API costs, all infra free)
- **Paid Pinecone needed**: Only if indexing multiple codebases or exceeding 2GB storage
- **Paid Vercel needed**: At ~10,000+ queries/day (serverless function invocation limits)

---

## 6. Optimization Opportunities

### Immediate Wins

| Optimization | Savings | Effort |
|-------------|---------|--------|
| **Response caching** -- cache LLM answers for repeated/similar queries | 30-50% on LLM costs | Low |
| **Embedding cache** -- cache query embeddings for identical queries | Negligible savings (embedding is cheap) | Low |
| **Reduce topK for simple queries** -- use topK=3 for straightforward lookups | ~40% reduction in input tokens | Low |

### Medium-Term Optimizations

| Optimization | Savings | Effort |
|-------------|---------|--------|
| **Prompt compression** -- shorten system prompts, remove redundant instructions | 5-10% on input tokens | Low |
| **Chunk summarization** -- store pre-summarized chunks alongside raw content | 20-30% on input tokens | Medium |
| **Streaming token limit** -- set `max_tokens` on LLM calls to cap output costs | Prevents runaway output costs | Low |

### Longer-Term Considerations

| Optimization | Impact | Effort |
|-------------|--------|--------|
| **Switch to local embeddings** (e.g., sentence-transformers) | Eliminates embedding API cost entirely | High |
| **Fine-tuned smaller model** for COBOL-specific tasks | Could reduce both latency and cost | High |
| **Incremental indexing** -- only re-embed changed files | Reduces re-ingestion cost to near-zero | Medium |
| **Semantic deduplication** -- detect and merge near-duplicate chunks | 10-20% fewer vectors, cheaper queries | Medium |

---

## 7. Cost Comparison with Alternatives

| Approach | Per-Query Cost | Setup Cost | Notes |
|----------|---------------|------------|-------|
| **LegacyLens (current)** | ~$0.0006 | ~$0.02 | GPT-4o-mini + text-embedding-3-small |
| GPT-4o instead of mini | ~$0.008 | ~$0.02 | 10x more expensive, marginally better quality |
| Claude 3.5 Sonnet | ~$0.005 | ~$0.02 | Higher quality, higher cost |
| Full GPT-4o (no RAG, full context) | ~$0.05+ | $0 | Impractical for 100K+ LOC (exceeds context window) |
| Local LLM (Ollama + llama3) | ~$0 (compute only) | Hardware cost | No API costs, requires GPU |

---

*Document generated for NAS-254. Costs based on OpenAI pricing as of February 2026.*
