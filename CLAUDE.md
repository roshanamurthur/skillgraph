# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SkillGraph is a node-graph LLM skill optimization system. It loads skills (markdown instruction files), runs them against benchmarks via LLM APIs, and uses a "master LLM" (xAI Grok) to iteratively optimize skills by generating hypotheses, creating variant child nodes, benchmarking them in parallel, and pruning losers.

## Commands

```bash
npm run dev          # Next.js dev server
npm run build        # Production build
npm run lint         # ESLint
python3 benchmark/run_benchmark.py --version v0  # Run Python benchmark
```

## Architecture

### Optimization Loop
1. User drops a skill `.md` file into a node → benchmark auto-runs
2. Master LLM (xAI Grok) analyzes benchmark results, ranks errors by importance
3. For the most important error, generates up to 5 hypotheses
4. Creates child nodes (one per hypothesis) with modified skill
5. Benchmarks all variants in parallel
6. Winner stays active, losers marked "pruned" (grayed out but visible)
7. Repeats from winner for next error category

### Key Directories
- `src/lib/optimization/` — Master LLM orchestration: error-analyzer, hypothesis-generator, variant-generator, selector, master-llm (async generator), xai-client
- `src/runtime/` — LLM client (OpenAI Responses API), skill loader, skill runner, script executor
- `src/lib/store/` — Filesystem persistence (skills, benchmarks, traces, py-benchmark results)
- `src/lib/types/` — Core interfaces (Skill, PyBenchmarkReport, etc.)
- `src/app/components/` — React Flow graph UI (GraphCanvas, DetailPanel, SkillNode, BenchmarkSection)
- `src/app/api/` — API routes: skills CRUD, py-benchmark, optimize (SSE streaming)
- `benchmark/` — Python benchmark runner with ground truth, test inputs, scoring
- `skill/` — Skill `.md` files synced for Python benchmark
- `logs/eval_results/` — Benchmark result JSONs with per-check location-pinpointed failures

### Benchmark System
- Python benchmark (`benchmark/run_benchmark.py`) runs skills via Claude CLI
- 5 test inputs (01_clean through 05_large), 5 scoring categories
- Each failed check includes: exact Excel cell location, expected/actual/delta, diagnostic hint
- Reports stored as `PyBenchmarkReport` JSON with `failures_by_location` grouping

### Skill Type
```typescript
interface Skill {
  id, name, version, parentId, prompt, model, score, files, createdAt,
  status?: "active" | "pruned",
  hypothesis?, changeSummary?, hypothesisId?, targetCriteria?
}
```

## Tech Stack
- Next.js 16 (App Router), React 19, TypeScript 5 (strict), Tailwind CSS 4
- OpenAI Responses API for skill execution (`src/runtime/llm-client.ts`)
- xAI Grok (`grok-4.20-beta-0309-reasoning`) for master LLM via same Responses API format
- React Flow (`@xyflow/react`) for graph visualization
- Path alias: `@/*` → `./src/*`
- Env vars: `OPENAI_API_KEY`, `XAI_API_KEY`, `DEEPSEEK_API_KEY`

## Key Patterns
- The LLM client uses OpenAI **Responses API** (`/responses` endpoint) — works for both OpenAI and xAI
- Master LLM uses function tools for structured output (error ranking, hypothesis submission, variant generation)
- Optimization runs as async generator yielding SSE events via `POST /api/optimize`
- Pruned nodes remain visible (grayed out) with hypothesis info viewable in DetailPanel
- Benchmarks auto-trigger when a skill file is dropped into a node (no manual button)
- Runtime data: `skillgraph-data/` (gitignored), benchmark results: `logs/eval_results/`
