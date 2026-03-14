# SkillGraph — Base Architecture Plan

## Context

We're building a node-graph LLM skill optimization system. The core idea: run a skill against benchmarks, trace failures, generate hypotheses, create variant skills in parallel, score them, and iterate. This is the foundational template for a hackathon — clear interfaces and module boundaries so 3-5 people can work in parallel.

---

## Project Structure

```
skillgraph/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                    # Public API re-exports
│   ├── cli.ts                      # CLI entry point
│   ├── types/
│   │   ├── index.ts                # Re-exports all types
│   │   ├── skill.ts                # Skill, SkillConfig, SkillVariant
│   │   ├── node.ts                 # GraphNode, NodePort, NodeEdge
│   │   ├── trace.ts                # Trace, TraceEvent, TraceTurn
│   │   ├── benchmark.ts            # Benchmark, EvalCase, EvalResult
│   │   ├── metric.ts               # Metric, ScoreCard, MetricDefinition
│   │   └── hypothesis.ts           # Hypothesis, AnalysisReport
│   ├── graph/
│   │   ├── engine.ts               # Graph executor — topo sort + parallel fan-out
│   │   ├── registry.ts             # Node type registry
│   │   └── graph.ts                # Graph builder — addNode, connect, validate
│   ├── nodes/
│   │   ├── run-skill.node.ts       # Execute skill against one eval case
│   │   ├── benchmark.node.ts       # Fan-out: emit each eval case
│   │   ├── trace-collector.node.ts # Aggregate traces from parallel runs
│   │   ├── analyzer.node.ts        # LLM-powered trace analysis
│   │   ├── hypothesis.node.ts      # Generate N hypotheses in parallel
│   │   ├── variant-gen.node.ts     # Generate skill variants from hypotheses
│   │   ├── scorer.node.ts          # Compute metrics on eval results
│   │   ├── selector.node.ts        # Pick best variant, decide iterate/stop
│   │   └── human-review.node.ts    # Pause for human input
│   ├── runtime/
│   │   ├── skill-runner.ts         # Invoke LLM with skill config
│   │   ├── llm-client.ts           # Thin LLM adapter (Anthropic SDK)
│   │   └── tracer.ts               # Structured trace logger
│   ├── metrics/
│   │   ├── accuracy.ts             # LLM-as-judge correctness scoring
│   │   ├── efficiency.ts           # Turns, wall-clock, token count
│   │   ├── cost.ts                 # Dollar cost estimation
│   │   └── composite.ts            # Weighted composite scorer
│   ├── store/
│   │   ├── fs-store.ts             # JSON file-based persistence
│   │   └── types.ts                # Store interface
│   └── human/
│       ├── correction-encoder.ts   # Convert human correction → eval row
│       └── curation.ts             # Eval set management
├── benchmarks/
│   └── example.benchmark.json
├── skills/
│   └── example.skill.json
└── tests/
```

---

## Core Pipeline (Node Graph)

```
[LoadSkill] → [LoadBenchmark] → [BenchmarkFanOut] → [RunSkill] (parallel per case)
                                                          ↓
                                                   [TraceCollector] (join)
                                                          ↓
                                                      [Scorer]
                                                          ↓
                                                     [Analyzer]
                                                          ↓
                                              [HypothesisGenerator] (fan-out N)
                                                          ↓
                                                  [VariantGenerator] (parallel per hypothesis)
                                                          ↓
                                    ┌──── [Benchmark + RunSkill + Scorer] per variant ────┐
                                    └──────────────── [Selector] ─────────────────────────┘
                                                          ↓
                                                  [Iterate or Done]
```

**Engine design:** Topological sort → execute in order. If a node returns an array, downstream non-join nodes run in parallel per element. Join nodes (tagged) wait and collect. Concurrency limiter (default 10) prevents rate-limit blowout.

---

## Key Interfaces

### Skill
```typescript
interface Skill {
  id: string; name: string; version: number;
  systemPrompt: string;
  examples?: Array<{ input: string; output: string }>;
  tools?: ToolDefinition[];
  model: string;
  params?: { temperature?: number; maxTokens?: number };
  parentId?: string;      // lineage
  hypothesisId?: string;  // which hypothesis spawned this
}
```

### GraphNode
```typescript
interface GraphNode<TInput, TOutput> {
  type: string;
  description: string;
  execute(input: TInput, ctx: NodeContext): Promise<TOutput>;
}

interface NodeContext {
  runId: string;
  log: (event: string, data?: Record<string, unknown>) => void;
  store: Store;
  signal: AbortSignal;
}
```

### Trace
```typescript
interface Trace {
  traceId: string; runId: string; skillId: string; evalCaseId: string;
  turns: TraceTurn[];
  outcome: "success" | "failure" | "error";
  metrics: { totalTurns: number; wallClockMs: number; totalTokens: number;
             toolCallCount: number; estimatedCostUsd: number };
}
```

### Benchmark / EvalCase
```typescript
interface Benchmark { id: string; name: string; cases: EvalCase[]; }
interface EvalCase {
  id: string; input: string;
  expected: { match?: string; pattern?: string; rubric?: string;
              expectedToolCalls?: Array<{ toolName: string }> };
  tags?: string[]; weight?: number; source?: string;
}
```

### Hypothesis
```typescript
interface Hypothesis {
  id: string; failurePattern: string; description: string;
  changeSpec: { target: "system-prompt"|"examples"|"tools"|"params"; instruction: string };
  confidence: number;
}
```

### Metrics
All normalized 0-1 (higher = better). Composite = weighted average.
- **accuracy** (0.5) — LLM-as-judge against rubric
- **efficiency-turns** (0.15) — `1 - turns/maxTurns`
- **efficiency-time** (0.1) — `1 - wallClockMs/budgetMs`
- **cost** (0.1) — `1 - costUsd/budgetUsd`
- **tool-precision** (0.15) — correct tool calls / total

### Store
```typescript
interface Store {
  saveSkill(skill: Skill): Promise<void>;
  loadSkill(id: string): Promise<Skill>;
  saveTrace(trace: Trace): Promise<void>;
  loadTraces(runId: string): Promise<Trace[]>;
  saveBenchmark(benchmark: Benchmark): Promise<void>;
  loadBenchmark(id: string): Promise<Benchmark>;
  appendEvalCase(benchmarkId: string, evalCase: EvalCase): Promise<void>;
}
```

---

## Human-in-the-Loop

1. **Corrections → eval rows:** `correction-encoder.ts` converts a human correction into an `EvalCase` with `weight: 2.0` and `source: "human-correction"`
2. **Pipeline pause:** `human-review.node.ts` writes pending items to a review queue, prompts in CLI mode
3. **Eval curation:** `curation.ts` — list/tag/remove/merge eval cases; flag always-passing cases as "too easy"
4. **Scheduled reflection:** Periodic job loads last N runs, LLM summarizes trends, suggests curation actions

---

## Implementation Steps

### Step 1: Scaffold project
- `package.json` with TypeScript, `tsx` for dev, `@anthropic-ai/sdk`
- `tsconfig.json` (strict, ESM)
- `.gitignore`

### Step 2: Write all type definitions (`src/types/`)
- This is the contract everyone works against
- Must be done first — all other work depends on it

### Step 3: Graph engine (`src/graph/`)
- `registry.ts` — simple `Map<string, GraphNode>` with register/get
- `engine.ts` — topological sort, fan-out/join logic, concurrency limiter
- `graph.ts` — builder API: `addNode()`, `connect()`, `validate()`, `toDefinition()`

### Step 4: Runtime (`src/runtime/`)
- `llm-client.ts` — thin wrapper over Anthropic SDK
- `tracer.ts` — wraps LLM calls, captures turns/timing/tokens into `Trace`
- `skill-runner.ts` — orchestrates: load skill → build messages → call LLM via tracer → return trace

### Step 5: Core nodes (`src/nodes/`)
- `run-skill.node.ts` — calls `skill-runner`, returns `Trace`
- `benchmark.node.ts` — fan-out: `Benchmark` → `Array<{skill, evalCase}>`
- `trace-collector.node.ts` — join: `Trace[]` → aggregated collection
- `scorer.node.ts` — runs metrics on traces, returns `ScoreCard`
- `analyzer.node.ts` — LLM reads failed traces, identifies failure patterns
- `hypothesis.node.ts` — LLM generates fix hypotheses from analysis
- `variant-gen.node.ts` — LLM rewrites skill based on hypothesis
- `selector.node.ts` — picks best variant by composite score

### Step 6: Metrics (`src/metrics/`)
- `accuracy.ts`, `efficiency.ts`, `cost.ts` — individual metric implementations
- `composite.ts` — weighted combination

### Step 7: Store + human loop (`src/store/`, `src/human/`)
- `fs-store.ts` — JSON file persistence in `./skillgraph-data/`
- `correction-encoder.ts` — correction → EvalCase
- `curation.ts` — eval set management functions

### Step 8: CLI (`src/cli.ts`)
- `skillgraph run <skill> <benchmark>` — single run
- `skillgraph optimize <skill> <benchmark> --iterations N` — full optimization loop
- `skillgraph review` — show pending human reviews
- `skillgraph curate <benchmark>` — interactive eval curation

### Step 9: Example data
- `skills/example.skill.json` — a simple code-review skill
- `benchmarks/example.benchmark.json` — 5-10 eval cases

---

## Hackathon Team Division

| Person | Owns | Key Deliverable |
|---|---|---|
| **P1** | `graph/`, `types/`, `cli.ts` | Graph engine + project scaffold |
| **P2** | `runtime/`, `nodes/{run-skill,benchmark,trace-collector}` | Skill execution + tracing |
| **P3** | `nodes/{analyzer,hypothesis,variant-gen}` | LLM-powered analysis + hypothesis generation |
| **P4** | `metrics/`, `nodes/{scorer,selector}` | Scoring system + variant selection |
| **P5** | `store/`, `human/`, `nodes/human-review` | Persistence + human-in-the-loop |

**Sequencing:** P1 writes types + scaffold first (hour 0-1). Then all work in parallel against interfaces. Integration at hour 3-4.

---

## Verification

1. **Unit tests per module:** Each node can be tested in isolation with mock inputs matching the type contracts
2. **Integration test:** Wire up full pipeline with a toy skill + 3-eval-case benchmark, run 1 optimization iteration
3. **CLI smoke test:** `npx tsx src/cli.ts optimize skills/example.skill.json benchmarks/example.benchmark.json --iterations 1`
4. **Check persistence:** Verify `skillgraph-data/` contains traces, scores, and variants after a run
5. **Human loop test:** Add a correction via CLI, verify it appears as a new eval case in the benchmark
