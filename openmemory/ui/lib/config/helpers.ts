/**
 * Shared config helpers — reads/writes config from Memgraph Config nodes.
 *
 * Config nodes: (c:Config {key, value}) where value is a JSON string.
 * Top-level keys: "openmemory" and "mem0".
 */
import { runRead, runWrite } from "@/lib/db/memgraph";

export function getDefaultConfiguration() {
  return {
    openmemory: {
      custom_instructions: null as string | null,
    },
    mem0: {
      vector_store: null as Record<string, unknown> | null,
    },
  };
}

export type AppConfig = ReturnType<typeof getDefaultConfiguration>;

/** Read full config from Memgraph, merging with defaults. */
export async function getConfigFromDb(): Promise<AppConfig> {
  try {
    const rows = await runRead(
      `MATCH (c:Config) RETURN c.key AS key, c.value AS value`,
      {}
    );
    const result: Record<string, any> = {};
    for (const r of rows as any[]) {
      try {
        result[r.key] = JSON.parse(r.value);
      } catch {
        result[r.key] = r.value;
      }
    }
    const defaults = getDefaultConfiguration();
    return {
      openmemory: result.openmemory ?? defaults.openmemory,
      mem0: result.mem0 ?? defaults.mem0,
    };
  } catch {
    return getDefaultConfiguration();
  }
}

/** Persist config to Memgraph, one Config node per top-level key. */
export async function saveConfigToDb(config: AppConfig): Promise<AppConfig> {
  for (const [key, value] of Object.entries(config)) {
    await runWrite(
      `MERGE (c:Config {key: $key}) SET c.value = $value`,
      { key, value: JSON.stringify(value) }
    );
  }
  return config;
}

export function deepUpdate(source: any, overrides: any): any {
  for (const key of Object.keys(overrides)) {
    if (
      typeof overrides[key] === "object" &&
      overrides[key] !== null &&
      !Array.isArray(overrides[key]) &&
      typeof source[key] === "object" &&
      source[key] !== null
    ) {
      source[key] = deepUpdate(source[key], overrides[key]);
    } else {
      source[key] = overrides[key];
    }
  }
  return source;
}

// ---------------------------------------------------------------------------
// Dedup config — Spec 03
// ---------------------------------------------------------------------------

export interface DedupConfig {
  enabled: boolean;
  threshold: number; // cosine similarity threshold 0–1
}

/**
 * Read dedup configuration from Memgraph config or return safe defaults.
 * Keyed under openmemory.dedup in the config JSON.
 */
export async function getDedupConfig(): Promise<DedupConfig> {
  try {
    const raw = await getConfigFromDb() as any;
    const dedupCfg = raw?.openmemory?.dedup ?? {};
    return {
      enabled: dedupCfg.enabled ?? true,
      threshold: dedupCfg.threshold ?? 0.92,
    };
  } catch {
    return { enabled: true, threshold: 0.92 };
  }
}

// ---------------------------------------------------------------------------
// Context window config — Spec 05
// ---------------------------------------------------------------------------

export interface ContextWindowConfig {
  enabled: boolean;
  size: number; // max memories to include as context (0 = disabled)
}

/**
 * Read context window configuration from Memgraph config or return safe defaults.
 * Keyed under openmemory.context_window in the config JSON.
 */
export async function getContextWindowConfig(): Promise<ContextWindowConfig> {
  try {
    const raw = await getConfigFromDb() as any;
    const ctx = raw?.openmemory?.context_window ?? {};
    return {
      enabled: ctx.enabled ?? true,
      size: Math.min(50, Math.max(0, ctx.size ?? 10)),
    };
  } catch {
    return { enabled: true, size: 10 };
  }
}
