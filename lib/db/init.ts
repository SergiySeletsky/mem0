/**
 * Memgraph schema bootstrap — Spec 00
 *
 * Re-exports initSchema from lib/db/memgraph.ts for use at app startup.
 * Call once per process (idempotent — "already exists" errors are silenced).
 */
export { initSchema } from "@/lib/db/memgraph";
