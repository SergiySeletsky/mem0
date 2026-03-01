/**
 * lib/mcp/dates.ts — Semantic date formatting for MCP responses
 *
 * Offloads temporal arithmetic to the backend so LLMs get human-readable
 * relative dates without having to parse raw ISO-8601 timestamps.
 *
 * Format: "YYYY-MM-DD (semantic bucket)"
 *   - "2026-02-28 (yesterday)"
 *   - "2025-08-15 (6 months ago)"
 *   - "2024-03-01 (2 years ago)"
 */

/**
 * Semantic buckets — precision inversely proportional to age.
 *
 * Recent memories get fine-grained labels so an LLM can distinguish
 * items created minutes apart within the same session:
 *
 *   < 1 min  → "just now"
 *   < 1 hour → "N minutes ago"      (minute-level)
 *   < 24 h   → "N hours ago"        (hour-level)
 *   < 48 h   → "yesterday"
 *   < 7 d    → "N days ago"         (day-level)
 *   < 60 d   → "N weeks ago"        (week-level)
 *   < 365 d  → "N months ago"       (month-level)
 *   ≥ 365 d  → "N years ago"        (year-level)
 */
function semanticBucket(deltaMs: number): string {
  const seconds = Math.floor(deltaMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30.44); // average days per month
  const years = Math.floor(days / 365);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  if (hours < 48) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 60) return `${weeks} ${weeks === 1 ? "week" : "weeks"} ago`;
  if (days < 365) return `${months} ${months === 1 ? "month" : "months"} ago`;
  return `${years} ${years === 1 ? "year" : "years"} ago`;
}

/**
 * Format an ISO-8601 timestamp as `YYYY-MM-DD (semantic bucket)`.
 *
 * @param isoTimestamp  ISO string like "2026-03-01T08:38:34.661Z" or "2026-03-01"
 * @param now           Current time (injectable for testing). Defaults to `new Date()`.
 * @returns             Formatted string or `null` if the input is falsy/unparseable.
 */
export function formatSemanticDate(
  isoTimestamp: string | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!isoTimestamp) return null;

  const date = new Date(isoTimestamp);
  if (isNaN(date.getTime())) return null;

  // YYYY-MM-DD prefix (strip time, tz, ms)
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const datePrefix = `${yyyy}-${mm}-${dd}`;

  const deltaMs = now.getTime() - date.getTime();
  // Future dates: just return the date without a bucket
  if (deltaMs < 0) return datePrefix;

  return `${datePrefix} (${semanticBucket(deltaMs)})`;
}

/**
 * Build the MCP date fields for a memory result.
 *
 * Returns `{ created_at }` for unmodified memories, or `{ created_at, updated_at }`
 * when the memory has been updated after creation.
 *
 * @param createdAt   ISO timestamp of memory creation
 * @param updatedAt   ISO timestamp of last modification (may be null/same as createdAt)
 * @param now         Current time (injectable for testing)
 */
export function buildDateFields(
  createdAt: string | null | undefined,
  updatedAt: string | null | undefined,
  now: Date = new Date(),
): { created_at: string | null; updated_at?: string | null } {
  const created_at = formatSemanticDate(createdAt, now);

  // Only include updated_at when it meaningfully differs from creation
  if (updatedAt && createdAt) {
    const createdDate = new Date(createdAt);
    const updatedDate = new Date(updatedAt);
    // Differ by more than 1 second (guards against minor ISO formatting diffs)
    if (
      !isNaN(createdDate.getTime()) &&
      !isNaN(updatedDate.getTime()) &&
      Math.abs(updatedDate.getTime() - createdDate.getTime()) > 1000
    ) {
      return { created_at, updated_at: formatSemanticDate(updatedAt, now) };
    }
  }

  return { created_at };
}
