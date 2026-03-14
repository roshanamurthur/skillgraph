# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SkillGraph is a node-graph LLM skill optimization system. It loads "Agent Skills" (SKILL.md files), runs them against benchmarks via LLM APIs, traces execution, scores results, generates improvement hypotheses, and iteratively creates better skill variants. See ARCHITECTURE.md for the full system design.

**Status:** Runtime layer (LLM client, skill loader, skill runner, script executor) is implemented. Graph engine, pipeline nodes, metrics, store, and CLI are stubs awaiting implementation.

## Commands

```bash
npm run dev          # Next.js dev server
npm run build        # Production build
npm run lint         # ESLint
npm run test:deepseek  # Integration test (runs tests/test-gpt.ts via tsx with dotenv)
```

Run a single test file directly:
```bash
npx tsx tests/test-gpt.ts [skill-directory] [user-message]
```

## Architecture

### Core Pipeline (from ARCHITECTURE.md)
LoadSkill → LoadBenchmark → BenchmarkFanOut → RunSkill → TraceCollector → Scorer → Analyzer → HypothesisGenerator → VariantGenerator → Selector

### Key Directories
- `src/runtime/` — **Implemented**: LLM client (OpenAI Responses API), skill loader (SKILL.md parser), skill runner (orchestrator with tool loop), script executor (sandboxed Python/Shell/JS/TS)
- `src/types/` — Core interfaces: `Trace`, `TraceTurn`, `LoadedAgentSkill`
- `src/lib/` — **Stubs only**: graph/, nodes/, metrics/, store/, human/
- `skills/` — Agent Skills format: each skill is a directory with SKILL.md (YAML frontmatter + body) and optional references/, scripts/, assets/
- `tests/` — Integration tests using tsx
- `benchmarks/` — Placeholder for evaluation cases

### Agent Skills Format
Each skill directory contains a `SKILL.md` with YAML frontmatter (name, description) and markdown body used as LLM instructions. Optional subdirectories: `scripts/`, `references/`, `assets/`.

## Tech Stack
- Next.js 16 (App Router), React 19, TypeScript 5 (strict), Tailwind CSS 4
- OpenAI Responses API (primary LLM integration in src/runtime/llm-client.ts)
- Anthropic SDK available but not currently used in runtime code
- Zod for validation, tsx for running TypeScript directly
- Path alias: `@/*` → `./src/*`

## Key Patterns
- The LLM client uses the OpenAI **Responses API** (not Chat Completions) — response parsing handles `reasoning_summary`, `function_call`, and extended output items
- Script execution is sandboxed: scripts must live under `scripts/`, no `..` path traversal, 30s timeout
- Skill runner supports up to 10 tool rounds per invocation by default
- Runtime data stored in `skillgraph-data/` (gitignored)
