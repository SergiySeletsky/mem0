/**
 * tests/unit/mcp/dates.test.ts — Unit tests for semantic date formatting.
 *
 * All tests inject a fixed `now` for deterministic assertions.
 */

import { formatSemanticDate, buildDateFields } from "@/lib/mcp/dates";

// Fixed reference point: 2026-03-01T12:00:00Z
const NOW = new Date("2026-03-01T12:00:00.000Z");

describe("formatSemanticDate", () => {
  it("DATE_01: returns null for falsy input", () => {
    expect(formatSemanticDate(null, NOW)).toBeNull();
    expect(formatSemanticDate(undefined, NOW)).toBeNull();
    expect(formatSemanticDate("", NOW)).toBeNull();
  });

  it("DATE_02: returns null for unparseable string", () => {
    expect(formatSemanticDate("not-a-date", NOW)).toBeNull();
  });

  it("DATE_03: 'just now' for <1 minute ago", () => {
    // 30 seconds ago
    const ts = "2026-03-01T11:59:30.000Z";
    expect(formatSemanticDate(ts, NOW)).toBe("2026-03-01 (just now)");
  });

  it("DATE_03b: 'N minutes ago' for 1-59 minutes", () => {
    // 30 minutes ago
    const ts = "2026-03-01T11:30:00.000Z";
    expect(formatSemanticDate(ts, NOW)).toBe("2026-03-01 (30 minutes ago)");
  });

  it("DATE_03c: '1 minute ago' singular", () => {
    const ts = "2026-03-01T11:59:00.000Z";
    expect(formatSemanticDate(ts, NOW)).toBe("2026-03-01 (1 minute ago)");
  });

  it("DATE_04: 'N hours ago' for 1-23 hours", () => {
    // 6 hours ago
    const ts = "2026-03-01T06:00:00.000Z";
    expect(formatSemanticDate(ts, NOW)).toBe("2026-03-01 (6 hours ago)");
  });

  it("DATE_04b: '1 hour ago' singular", () => {
    const ts = "2026-03-01T11:00:00.000Z";
    expect(formatSemanticDate(ts, NOW)).toBe("2026-03-01 (1 hour ago)");
  });

  it("DATE_05: 'yesterday' for 24-47 hours ago", () => {
    // 30 hours ago
    const ts = "2026-02-28T06:00:00.000Z";
    expect(formatSemanticDate(ts, NOW)).toBe("2026-02-28 (yesterday)");
  });

  it("DATE_06: 'N days ago' for 2-6 days", () => {
    // 5 days ago
    const ts = "2026-02-24T12:00:00.000Z";
    expect(formatSemanticDate(ts, NOW)).toBe("2026-02-24 (5 days ago)");
  });

  it("DATE_07: 'N weeks ago' for 7-59 days", () => {
    // 21 days = 3 weeks
    const ts = "2026-02-08T12:00:00.000Z";
    expect(formatSemanticDate(ts, NOW)).toBe("2026-02-08 (3 weeks ago)");
  });

  it("DATE_08: '1 week ago' singular", () => {
    // Exactly 7 days
    const ts = "2026-02-22T12:00:00.000Z";
    expect(formatSemanticDate(ts, NOW)).toBe("2026-02-22 (1 week ago)");
  });

  it("DATE_09: 'N months ago' for 60-364 days", () => {
    // 90 days ≈ 3 months
    const ts = "2025-12-01T12:00:00.000Z";
    expect(formatSemanticDate(ts, NOW)).toBe("2025-12-01 (2 months ago)");
  });

  it("DATE_10: '1 month ago' singular", () => {
    // 60 days = floor(60/30.44) = 1 month
    const ts = "2025-12-31T12:00:00.000Z";
    expect(formatSemanticDate(ts, NOW)).toBe("2025-12-31 (1 month ago)");
  });

  it("DATE_11: 'N years ago' for 365+ days", () => {
    // ~730 days = 2 years
    const ts = "2024-03-01T12:00:00.000Z";
    expect(formatSemanticDate(ts, NOW)).toBe("2024-03-01 (2 years ago)");
  });

  it("DATE_12: '1 year ago' singular", () => {
    // ~366 days
    const ts = "2025-02-28T12:00:00.000Z";
    expect(formatSemanticDate(ts, NOW)).toBe("2025-02-28 (1 year ago)");
  });

  it("DATE_13: future date returns date-only (no bucket)", () => {
    const ts = "2027-01-01T00:00:00.000Z";
    expect(formatSemanticDate(ts, NOW)).toBe("2027-01-01");
  });

  it("DATE_14: strips time/ms/tz from full ISO string", () => {
    const ts = "2026-02-28T14:35:22.789+03:00";
    // UTC = 11:35 on Feb 28, NOW = 12:00 on Mar 1 → ~24h25m → "yesterday"
    expect(formatSemanticDate(ts, NOW)).toBe("2026-02-28 (yesterday)");
  });

  it("DATE_15: handles date-only string (no time)", () => {
    // "2026-01-01" — parsed as midnight UTC, 59 days before NOW → 8 weeks ago
    const ts = "2026-01-01";
    expect(formatSemanticDate(ts, NOW)).toBe("2026-01-01 (8 weeks ago)");
  });
});

describe("buildDateFields", () => {
  it("BUILD_01: returns only 'created_at' when updatedAt is null", () => {
    const result = buildDateFields("2026-02-28T06:00:00.000Z", null, NOW);
    expect(result).toEqual({ created_at: "2026-02-28 (yesterday)" });
    expect(result).not.toHaveProperty("updated_at");
  });

  it("BUILD_02: returns only 'created_at' when updatedAt equals createdAt", () => {
    const ts = "2026-02-28T06:00:00.000Z";
    const result = buildDateFields(ts, ts, NOW);
    expect(result).toEqual({ created_at: "2026-02-28 (yesterday)" });
    expect(result).not.toHaveProperty("updated_at");
  });

  it("BUILD_03: returns only 'created_at' when difference <= 1 second", () => {
    const result = buildDateFields(
      "2026-02-28T06:00:00.000Z",
      "2026-02-28T06:00:00.500Z",
      NOW,
    );
    expect(result).toEqual({ created_at: "2026-02-28 (yesterday)" });
    expect(result).not.toHaveProperty("updated_at");
  });

  it("BUILD_04: includes updated_at when meaningfully different", () => {
    const result = buildDateFields(
      "2026-01-01T00:00:00.000Z",
      "2026-02-15T00:00:00.000Z",
      NOW,
    );
    expect(result).toHaveProperty("created_at");
    expect(result).toHaveProperty("updated_at");
    expect(result.created_at).toBe("2026-01-01 (8 weeks ago)");
    expect(result.updated_at).toBe("2026-02-15 (2 weeks ago)");
  });

  it("BUILD_05: both fields null returns { created_at: null }", () => {
    const result = buildDateFields(null, null, NOW);
    expect(result).toEqual({ created_at: null });
  });

  it("BUILD_06: createdAt null, updatedAt present returns { created_at: null }", () => {
    const result = buildDateFields(null, "2026-02-28T06:00:00.000Z", NOW);
    expect(result).toEqual({ created_at: null });
  });
});
