export {};
/**
 * Unit tests — apps/[appId]/accessed and apps/[appId]/memories routes
 *
 * Verifies bi-temporal guards (m.invalidAt IS NULL) are present in both
 * data and count queries, so superseded/paused/archived memories are excluded.
 *
 *   ROUTE_BT_01: accessed route main query includes invalidAt IS NULL
 *   ROUTE_BT_02: accessed route count query includes invalidAt IS NULL
 *   ROUTE_BT_03: memories route main query includes invalidAt IS NULL
 *   ROUTE_BT_04: memories route count query includes invalidAt IS NULL
 */

const mockRunRead = jest.fn();

jest.mock("@/lib/db/memgraph", () => ({
  runRead: (...args: unknown[]) => mockRunRead(...args),
}));

import { NextRequest } from "next/server";

// Helper to build a NextRequest with URL
function makeRequest(url: string): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"));
}

// Helper to build route params
function makeParams(appId: string) {
  return { params: Promise.resolve({ appId }) };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// accessed route
// ---------------------------------------------------------------------------
describe("apps/[appId]/accessed — bi-temporal guards", () => {
  let GET: (req: NextRequest, ctx: { params: Promise<{ appId: string }> }) => Promise<Response>;

  beforeAll(async () => {
    const mod = await import("@/app/api/v1/apps/[appId]/accessed/route");
    GET = mod.GET;
  });

  it("ROUTE_BT_01: main query includes m.invalidAt IS NULL", async () => {
    mockRunRead
      .mockResolvedValueOnce([]) // data
      .mockResolvedValueOnce([{ total: 0 }]); // count

    await GET(
      makeRequest("http://localhost:3000/api/v1/apps/my-app/accessed"),
      makeParams("my-app"),
    );

    const dataCypher = mockRunRead.mock.calls[0][0] as string;
    expect(dataCypher).toContain("m.invalidAt IS NULL");
  });

  it("ROUTE_BT_02: count query includes m.invalidAt IS NULL", async () => {
    mockRunRead
      .mockResolvedValueOnce([]) // data
      .mockResolvedValueOnce([{ total: 0 }]); // count

    await GET(
      makeRequest("http://localhost:3000/api/v1/apps/my-app/accessed"),
      makeParams("my-app"),
    );

    const countCypher = mockRunRead.mock.calls[1][0] as string;
    expect(countCypher).toContain("invalidAt IS NULL");
  });
});

// ---------------------------------------------------------------------------
// memories route
// ---------------------------------------------------------------------------
describe("apps/[appId]/memories — bi-temporal guards", () => {
  let GET: (req: NextRequest, ctx: { params: Promise<{ appId: string }> }) => Promise<Response>;

  beforeAll(async () => {
    const mod = await import("@/app/api/v1/apps/[appId]/memories/route");
    GET = mod.GET;
  });

  it("ROUTE_BT_03: main query includes m.invalidAt IS NULL", async () => {
    mockRunRead
      .mockResolvedValueOnce([]) // data
      .mockResolvedValueOnce([{ total: 0 }]); // count

    await GET(
      makeRequest("http://localhost:3000/api/v1/apps/my-app/memories"),
      makeParams("my-app"),
    );

    const dataCypher = mockRunRead.mock.calls[0][0] as string;
    expect(dataCypher).toContain("m.invalidAt IS NULL");
  });

  it("ROUTE_BT_04: count query includes m.invalidAt IS NULL", async () => {
    mockRunRead
      .mockResolvedValueOnce([]) // data
      .mockResolvedValueOnce([{ total: 0 }]); // count

    await GET(
      makeRequest("http://localhost:3000/api/v1/apps/my-app/memories"),
      makeParams("my-app"),
    );

    const countCypher = mockRunRead.mock.calls[1][0] as string;
    expect(countCypher).toContain("invalidAt IS NULL");
  });
});
