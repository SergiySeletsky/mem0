# OpenMemory UI — Agent Log

## Summary

Running project log for all agent sessions. Most recent entries at bottom.

---

## Session 1 — Workspace Configuration & App Fix

### Changes Made

**Root workspace (`c:\Users\Selet\source\repos\mem0\mem0`)**
- `package.json`: Added `"type": "module"`, `scripts` (lint, format, format:check), and shared `devDependencies`: `@eslint/js@^9`, `@types/node@^22`, `dotenv@^16`, `eslint@^9`, `jest@^29.7.0`, `prettier@^3.5.2`, `ts-jest@^29.4.6`, `typescript@5.5.4`, `typescript-eslint@^8`
- `.npmrc` (NEW): `shamefully-hoist=true` — required for Next.js on Windows with pnpm workspaces (see Patterns section)
- `prettier.config.js` (NEW): Shared Prettier config (`printWidth:100`, double quotes, trailing commas, LF line endings)
- `.prettierignore` (NEW): Excludes `node_modules`, `dist`, `.next`, lock files, coverage
- `eslint.config.js` (NEW): ESLint 9 flat config with `typescript-eslint@8`; warns on `no-explicit-any`; test file overrides

**`mem0-ts/`**
- `package.json`: Removed hoisted devDeps; added `@types/sqlite3@^3.1.11`
- `tsconfig.json`: Excluded `src/community` (has own tsconfig + unresolvable peers)
- `src/oss/src/types/index.ts`: Added `timeout?: number`, `maxRetries?: number` to `LLMConfig`
- `src/oss/src/reranker/index.ts`: Split `export type` from value exports (isolatedModules compliance)
- `src/client/mem0.ts`: 3x `@ts-ignore` → `@ts-expect-error` with inline justification
- `src/client/telemetry.ts`: Removed `@ts-nocheck`; typed `additionalData` param; annotated empty catch
- `src/oss/src/llms/langchain.ts`: Removed empty `else {}`; removed useless re-throw try/catch
- `src/oss/src/memory/index.ts`: Annotated empty telemetry catch
- `src/oss/src/reranker/cohere.ts`: `eslint-disable-next-line` for lazy `require()`
- `src/oss/src/vector_stores/redis.ts`: `Number(x) ?? 0` → `Number(x) || 0` (NaN is falsy, not null)
- `src/oss/src/utils/telemetry.ts`: Annotated empty env-check catch

**`openmemory/ui/`**
- `package.json`: Removed hoisted devDeps; downgraded `@jest/globals`, `@types/jest`, `jest-environment-node` from `@30` → `@29` (to match hoisted `jest@29`)
- `tsconfig.json`: Added `jest.config.ts` and `jest.e2e.config.ts` to `exclude` (prevents `@types/jest@29` ambient declaration conflict)
- `components/Navbar.tsx`: Added `if (!pathname) return false` guard in `isActive()` (fixes null crash during SSR hydration)
- `next.config.mjs`: Added `serverExternalPackages: ["neo4j-driver"]` and custom webpack externals for `neo4j-driver`

**`.github/copilot-instructions.md`**
- Appended Core Execution Framework: Autonomy Mandate, Execution Protocol, Error Recovery (4-tier table), State Management (AGENTS.md), Playwright MCP monitoring
- Appended Quality Gates: TypeScript gates, Testing gates (≥90% coverage), Enforcement rules

### Verification Run
- `pnpm exec tsc --noEmit` in `mem0-ts`: **0 errors**
- ESLint on `mem0-ts`: **0 errors**, 263 warnings (all in test files, intentional `no-explicit-any`)
- `openmemory/ui` TS: **1 pre-existing error** (`entities/[entityId]/route.ts` — params not Promise, known Next.js 15 issue)
- App at `http://localhost:3000`: **loads correctly**, all API routes return 200

---

## Patterns

### Windows + pnpm workspace: webpack drive-letter casing bug

**Symptom:** `invariant expected layout router to be mounted` crash on every page load; webpack console warnings: `WARNING: multiple modules with names that only differ in casing`.

**Root Cause:** pnpm's symlink-based virtual store (`node_modules/.pnpm/...`) produces inconsistent drive-letter casing on Windows (e.g. `C:\...` vs `c:\...`). Webpack on case-insensitive Windows FS treats these as two different modules, so Next.js internal modules (`layout-router.js`, `react-dom`, etc.) get bundled twice, causing the React invariant failure.

**Fix:** Add `shamefully-hoist=true` to `.npmrc` at workspace root. This makes pnpm use a flat `node_modules` layout (like npm/yarn), eliminating the symlinks that trigger the casing ambiguity. Run `pnpm install` (with `CI=true` to skip TTY prompts if needed) after adding `.npmrc`.

**Anti-fix:** `config.resolve.symlinks = false` in `next.config.mjs` actually made this **worse** (increased casing warnings) by preventing webpack from normalising resolved paths back through symlinks. Revert this if applied.

### Memgraph Cypher: always anchor to User node

Never query `Memory` directly:
```cypher
-- ❌ WRONG
MATCH (m:Memory {id: $memId})
-- ✅ CORRECT
MATCH (u:User {userId: $userId})-[:HAS_MEMORY]->(m:Memory {id: $memId})
```

### SKIP/LIMIT in Memgraph

Always use `toInteger()` or parameterised values via `wrapSkipLimit()`. Literal integers in SKIP/LIMIT fail in Memgraph.

### pnpm onlyBuiltDependencies

The `pnpm.onlyBuiltDependencies` field only takes effect at the **workspace root** `package.json`. Remove from individual package `package.json` files and consolidate at root.

---

## Known Pre-existing Issues (do not investigate)

- `tests/unit/entities/resolve.test.ts`: 3 failing unit tests — pre-existing, do not fix
- `app/api/v1/entities/[entityId]/route.ts`: TS2344 error on route params type — pre-existing Next.js 15 known issue, tracked upstream
