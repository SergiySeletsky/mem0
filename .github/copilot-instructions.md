# OpenMemory — Copilot Instructions

## Architecture

OpenMemory is a **single Next.js 15 full-stack monolith** (`openmemory/ui/`).
There is no separate backend — API routes live alongside UI pages.

```
openmemory/ui/
  app/api/v1/        ← 25 Next.js App Router API routes (all memory, app, config, backup)
  app/api/mcp/       ← MCP SSE transport (Model Context Protocol server)
  lib/db/memgraph.ts ← ONLY database layer — all data lives in Memgraph
  lib/memory/write.ts← Full write pipeline (embed → dedup → write → categorize → entity extract)
  lib/memory/search.ts← listMemories() — used by GET routes
  lib/search/hybrid.ts← BM25 + vector + Reciprocal Rank Fusion (Spec 02)
  lib/ai/client.ts   ← getLLMClient() singleton (OpenAI or Azure)
  lib/embeddings/intelli.ts ← embed() — default provider: intelli-embed-v3 (1024-dim, local ONNX INT8 via @huggingface/transformers, no API key needed); falls back to Azure if configured
```

## Memgraph Data Model

All data is in Memgraph (not SQLite, not PostgreSQL). The graph schema:

```cypher
(User)-[:HAS_MEMORY]->(Memory)-[:CREATED_BY]->(App)
(Memory)-[:HAS_CATEGORY]->(Category)
(Memory)-[:HAS_ENTITY]->(Entity)
(Memory)-[:SUPERSEDES]->(OldMemory)   // bi-temporal, Spec 01
(App)-[:ACCESSED]->(Memory)           // access log
(Config {key, value})                 // standalone nodes, key = "openmemory"|"mem0"
```

**All Cypher queries must anchor to a User node first (Spec 09 — namespace isolation):**
```typescript
// ✅ CORRECT
MATCH (u:User {userId: $userId})-[:HAS_MEMORY]->(m:Memory {id: $memId})
// ❌ WRONG — never query Memory directly
MATCH (m:Memory {id: $memId})
```

## Critical Patterns

### Database access
Always use `runRead` / `runWrite` from `@/lib/db/memgraph`. Never import `neo4j-driver` directly.
```typescript
const rows = await runRead(`MATCH ...`, { userId, ... });
const rows = await runWrite(`MERGE ...`, { ... });
```

**SKIP/LIMIT must use `$params` — never literals.** `wrapSkipLimit()` auto-rewrites them to `toInteger()` for Memgraph compatibility.

### Bi-temporal reads (Spec 01)
Live memories always filtered with `WHERE m.invalidAt IS NULL`. Edits call `supersedeMemory()` (creates new node + `[:SUPERSEDES]` edge + sets `old.invalidAt`). Never use in-place UPDATE for user-visible content changes.

### Write pipeline (addMemory)
`lib/memory/write.ts`: context window → embed → dedup check → `CREATE Memory` node → attach App → fire-and-forget: `categorizeMemory()` + `processEntityExtraction()`. Any new write should follow this pipeline rather than writing Memory nodes directly.

### LLM / Embedding clients
Use `getLLMClient()` from `lib/ai/client.ts` and `embed()` from `lib/embeddings/openai.ts`. LLM singleton auto-selects Azure or OpenAI based on env vars. Model for LLM calls: `process.env.LLM_AZURE_DEPLOYMENT ?? process.env.OPENMEMORY_CATEGORIZATION_MODEL ?? "gpt-4o-mini"`. Default embedding provider is [`serhiiseletskyi/intelli-embed-v3`](https://huggingface.co/serhiiseletskyi/intelli-embed-v3) — a custom-trained arctic-embed-l-v2 finetune, 1024-dim, INT8 ONNX, runs locally via `@huggingface/transformers` with no API key; chosen after benchmarking 21 providers because it beats Azure on dedup and negation safety metrics while running at ~11ms on CPU.

### Async config
`getConfigFromDb()` / `getDedupConfig()` / `getContextWindowConfig()` are **async** — they read Memgraph `Config` nodes. All callers must `await` them.

### Next.js App Router route params
All dynamic route params are `Promise` in Next.js 15:
```typescript
type RouteParams = { params: Promise<{ memoryId: string }> };
export async function GET(req: NextRequest, { params }: RouteParams) {
  const { memoryId } = await params;
```

## Dev Workflow

```bash
# Start dev server (from openmemory/ui/)
pnpm dev                       # port 3000

# Start Memgraph + Memgraph MAGE (required — plain Memgraph lacks BM25/vector indexes)
cd openmemory && docker-compose up

# Type check
pnpm exec tsc --noEmit

# Unit tests (must run in-band)
pnpm test

# Playwright E2E (requires running dev server)
pnpm test:pw
```

**Known pre-existing failures:** 3 tests in `tests/unit/entities/resolve.test.ts` and a `.next/types` TS error for `app/api/v1/entities/[entityId]/route.ts` — ignore these.

## Environment Variables

```
MEMGRAPH_URL=bolt://localhost:7687
MEMGRAPH_USER=memgraph
MEMGRAPH_PASSWORD=memgraph
OPENAI_API_KEY=sk-...
NEXT_PUBLIC_USER_ID=user          # identifies the active user in the UI
```
Azure LLM: `LLM_AZURE_OPENAI_API_KEY` + `LLM_AZURE_ENDPOINT` + `LLM_AZURE_DEPLOYMENT`
Azure Embedding: `EMBEDDING_AZURE_OPENAI_API_KEY` + `EMBEDDING_AZURE_ENDPOINT`

## Spec Reference

Features are tracked inline in source files and code comments. Key specs by domain:
bi-temporal writes, hybrid search (BM25+vector RRF), dedup, entity extraction,
context window, bulk ingestion, community detection, cross-encoder reranking, namespace isolation.

## Frontend Conventions

- Redux store in `store/`. Hooks in `hooks/` (e.g. `useMemoriesApi.ts`) call relative API URLs — no `NEXT_PUBLIC_API_URL`.
- `Memory.memory` (in Redux) = display text. API uses `content` (DB) and `text` (GET response).
- Async fire-and-forget calls (categorization, entity extraction) must `.catch(e => console.warn(...))` — never let them throw into the write pipeline.

## Schema Initialization

`instrumentation.ts` calls `initSchema()` (from `lib/db/memgraph.ts`) on server start to create Memgraph vector index, text index, and constraints idempotently. No manual migration step needed.


---

## Core Execution Framework

### Autonomy Mandate

- **No confirmation loops.** Proceed from analysis to implementation to verification without asking for approval unless a decision is irreversible (e.g., deleting data, publishing to npm).
- **Infer intent.** When a request is ambiguous, pick the most reasonable interpretation, execute it, and state what you chose.
- **Execution order:** Analyse ? Plan ? Implement ? Verify ? Report. Never stop at the plan step.

### Execution Protocol

Before touching code on any non-trivial task:

1. **Dependency map** � identify which files/routes/DB queries are affected and whether changes can be made in parallel.
2. **Risk classification** � label each change: `Technical | Performance | Security | Data`. Anything touching Memgraph writes or auth is `Security`; anything touching `runWrite` in bulk is `Data`.
3. **Quality checkpoints** � define the verification step for each change (type-check, unit test, manual curl, Playwright run).
4. **Rollback point** � if the change touches the write pipeline or schema, note the last known-good state so a revert path is clear.

### Error Recovery

Apply this pipeline in order � stop when the issue is resolved:

| Tier | Check | Command |
|------|-------|---------|
| 1 | Type errors | `pnpm exec tsc --noEmit` (run from `openmemory/ui/`) |
| 2 | Unit tests | `pnpm --filter my-v0-project test` |
| 3 | Build | `pnpm --filter my-v0-project build` |
| 4 | E2E | `pnpm --filter my-v0-project test:pw` (requires dev server + Memgraph) |

**Error classification ? default action:**

- `Syntax / Type` � fix in place, re-run tier 1.
- `Build` � check Next.js dynamic-params pattern (`await params`), then check tsup entry in `mem0-ts`.
- `Dependency` � check pnpm hoisting; run `pnpm why <pkg>` to trace the resolution.
- `Configuration` � check env vars above; missing `OPENAI_API_KEY` surfaces as a 500 on `/api/v1/memories`.
- `Test_Failure` � confirm it is not one of the 3 known pre-existing failures in `tests/unit/entities/resolve.test.ts` before investigating.
- `Runtime / Integration` � use Playwright MCP to inspect live DOM, console errors, and network requests before editing code.

**3-attempt limit:** If a fix fails 3 times at the same tier, escalate: quick-patch ? targeted refactor ? revert to last known-good state. Do not repeat the same change.

### State Management (AGENTS.md)

- **Single source of truth:** Keep `openmemory/ui/AGENTS.md` (create if absent) as the running project log.
- **Record after every non-trivial task:** what changed, which files, what verification was run, any follow-up items.
- **Never create separate per-task markdown files** — append all updates directly to `AGENTS.md`.
- **Pattern capture:** When a bug reveals a systemic issue (e.g., bare `MATCH (m:Memory �)` without User anchor), document it in `AGENTS.md` under `## Patterns` so it is not repeated.
- **Token-limit recovery:** If context grows large, compress prior entries into a summary block in `AGENTS.md` before continuing.

### Runtime Monitoring with Playwright MCP

When the dev server is running (`pnpm --filter my-v0-project dev`), use Playwright MCP tools to debug live issues **before** editing source:

1. `mcp_playwright_browser_navigate` � load the relevant page.
2. `mcp_playwright_browser_console_messages` (`level: "error"`) � capture JS errors.
3. `mcp_playwright_browser_network_requests` � inspect failed API calls and response bodies.
4. `mcp_playwright_browser_snapshot` � analyse DOM / accessibility tree state.
5. `mcp_playwright_browser_evaluate` � query in-page state (Redux store, component props, `performance` entries).

**Prioritise live inspection over guessing.** Capture console + network before reading source when investigating a UI bug.

**Core Web Vitals baseline** (record deltas in `AGENTS.md` after significant UI changes):
LCP < 2.5 s � CLS < 0.1 � INP < 200 ms � measure via `performance.getEntriesByType('navigation')` in `mcp_playwright_browser_evaluate`.

### Quality Gates & Enforcement

Every change must clear all applicable gates before being considered done. Do not mark a task complete if any gate below is failing.

#### TypeScript

| Gate | Rule | Command |
|------|------|---------|
| Strict mode | `tsconfig.json` must have `"strict": true` � never weaken it | `pnpm exec tsc --noEmit` |
| Zero errors | `tsc --noEmit` must exit 0 with no errors or suppressions | `pnpm exec tsc --noEmit` |
| No `any` escape hatches | `@ts-ignore` / `@ts-expect-error` require an inline comment explaining why; `@ts-nocheck` is banned | grep before commit |
| API contract coverage | Every exported function, route handler, and `runRead`/`runWrite` call site must have explicit input/output types � no implicit `any` on API boundaries | `pnpm exec tsc --noEmit` |

#### Testing

| Gate | Rule | Command |
|------|------|---------|
| All tests pass | Zero failures; the 3 known pre-existing failures in `tests/unit/entities/resolve.test.ts` are the only permitted exceptions | `pnpm --filter my-v0-project test` |
| Coverage = 90 % | Line + branch coverage must be = 90 % on new code paths; check with `--coverage` | `pnpm --filter my-v0-project test --coverage` |
| Performance benchmarks | API routes added or modified must be manually verified < 200 ms p95 under normal load; record result in `AGENTS.md` | Playwright network tab or `mcp_playwright_browser_network_requests` |

#### Enforcement

- **Block on gate failure.** Do not move to the next implementation step if TypeScript errors or test failures exist.
- **No coverage exemptions** on code that touches `runWrite`, the write pipeline (`lib/memory/write.ts`), or auth logic � these are `Security / Data` risk and require full branch coverage.
- **Regressions are bugs.** If a change causes a previously passing test to fail, fix the regression before proceeding rather than skipping or deleting the test.