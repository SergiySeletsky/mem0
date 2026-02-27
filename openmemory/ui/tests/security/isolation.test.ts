export {};

/**
 * Security unit tests for Spec 09 — Namespace Isolation Hardening
 *
 * NS_SEC_01 — requireUserId returns userId string when present in query params
 * NS_SEC_02 — requireUserId returns 400 response when user_id is absent
 * NS_SEC_03 — requireUserId returns 400 response when user_id is empty string
 * NS_SEC_04 — requireUserId accepts user_id from x-user-id header fallback
 * NS_SEC_05 — GET [memoryId] with wrong user returns 404 (graph isolation)
 * NS_SEC_06 — GET [memoryId]/related with wrong user returns 404 (graph isolation)
 */

// ---------------------------------------------------------------------------
// Mock neo4j-driver (needed when importing route modules)
// ---------------------------------------------------------------------------
const mockSession = {
  run: jest.fn(),
  close: jest.fn().mockResolvedValue(undefined),
};
const mockDriver = {
  session: jest.fn().mockReturnValue(mockSession),
  close: jest.fn().mockResolvedValue(undefined),
  verifyConnectivity: jest.fn().mockResolvedValue(undefined),
};
jest.mock("neo4j-driver", () => ({
  __esModule: true,
  default: {
    driver: jest.fn().mockReturnValue(mockDriver),
    auth: { basic: jest.fn().mockReturnValue({ scheme: "basic" }) },
    integer: { toNumber: (n: any) => (typeof n === "object" ? n.low ?? n : n) },
    types: { Node: class {}, Relationship: class {} },
  },
}));

// ---------------------------------------------------------------------------
// Mock lib/db/memgraph runRead / runWrite
// ---------------------------------------------------------------------------
const mockRunRead = jest.fn();
const mockRunWrite = jest.fn();

jest.mock("@/lib/db/memgraph", () => ({
  runRead: (...args: any[]) => mockRunRead(...args),
  runWrite: (...args: any[]) => mockRunWrite(...args),
  initSchema: jest.fn().mockResolvedValue(undefined),
  getDriver: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Mock lib/memory/write (supersedeMemory etc.)
// ---------------------------------------------------------------------------
jest.mock("@/lib/memory/write", () => ({
  addMemory: jest.fn(),
  deleteMemory: jest.fn().mockResolvedValue(true),
  supersedeMemory: jest.fn(),
  archiveMemory: jest.fn().mockResolvedValue(true),
  pauseMemory: jest.fn().mockResolvedValue(true),
  updateMemoryState: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Mock everything else the route might pull in
// ---------------------------------------------------------------------------
jest.mock("@/lib/entities/worker", () => ({
  processEntityExtraction: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/lib/dedup", () => ({
  checkDeduplication: jest.fn().mockResolvedValue({ action: "insert" }),
}));
jest.mock("@/lib/memory/search", () => ({
  listMemories: jest.fn().mockResolvedValue({ memories: [], total: 0 }),
}));
jest.mock("@/lib/search/hybrid", () => ({
  hybridSearch: jest.fn().mockResolvedValue([]),
}));
jest.mock("@/lib/config/helpers", () => ({
  getConfigFromDb: jest.fn().mockResolvedValue({}),
  getContextWindowConfig: jest.fn().mockResolvedValue({ enabled: false, size: 0 }),
}));
jest.mock("@/lib/memory/context", () => ({
  buildContextPrefix: jest.fn().mockResolvedValue(""),
}));
jest.mock("openai", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: jest.fn() } },
    embeddings: { create: jest.fn() },
  })),
}));

// ---------------------------------------------------------------------------
// Helper: create a lightweight mock NextRequest
// ---------------------------------------------------------------------------
function makeMockRequest(options: {
  method?: string;
  url?: string;
  searchParams?: Record<string, string>;
  headers?: Record<string, string>;
  body?: unknown;
}) {
  const url = options.url ?? `http://localhost:3000/api/v1/memories/test-id`;
  const fullUrl = new URL(url);
  if (options.searchParams) {
    Object.entries(options.searchParams).forEach(([k, v]) =>
      fullUrl.searchParams.set(k, v)
    );
  }

  return {
    method: options.method ?? "GET",
    url: fullUrl.toString(),
    nextUrl: fullUrl,
    headers: {
      get: (name: string) => options.headers?.[name.toLowerCase()] ?? null,
    },
    json: jest.fn().mockResolvedValue(options.body ?? {}),
  };
}

// ---------------------------------------------------------------------------
// Import dependencies
// ---------------------------------------------------------------------------

// Tests run AFTER implementation exists, so these imports will be valid then
// During RED phase: module not found — tests fail as expected

describe("requireUserId — Spec 09", () => {
  let requireUserId: ((req: any) => any) | undefined;

  beforeEach(async () => {
    // Dynamically import to allow module to not exist during baseline
    const mod = await import("@/middleware/userValidation").catch(() => null);
    requireUserId = mod?.requireUserId;
  });

  test("NS_SEC_01: returns userId string when user_id is in query params", () => {
    if (!requireUserId) {
      throw new Error("middleware/userValidation.ts does not exist yet");
    }
    const req = makeMockRequest({ searchParams: { user_id: "alice" } });
    const result = requireUserId(req);
    expect(result).toBe("alice");
  });

  test("NS_SEC_02: returns 400-like error when user_id is absent", () => {
    if (!requireUserId) {
      throw new Error("middleware/userValidation.ts does not exist yet");
    }
    const req = makeMockRequest({});
    const result = requireUserId(req) as any;
    // Should be a NextResponse-like object (not a string)
    expect(typeof result).not.toBe("string");
    // Should carry 400 status
    expect(result.status).toBe(400);
  });

  test("NS_SEC_03: returns 400 when user_id is empty string", () => {
    if (!requireUserId) {
      throw new Error("middleware/userValidation.ts does not exist yet");
    }
    const req = makeMockRequest({ searchParams: { user_id: "   " } });
    const result = requireUserId(req) as any;
    expect(typeof result).not.toBe("string");
    expect(result.status).toBe(400);
  });

  test("NS_SEC_04: accepts user_id from x-user-id header", () => {
    if (!requireUserId) {
      throw new Error("middleware/userValidation.ts does not exist yet");
    }
    const req = makeMockRequest({ headers: { "x-user-id": "bob" } });
    const result = requireUserId(req);
    expect(result).toBe("bob");
  });
});

describe("Route isolation — Spec 09", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: db returns empty (simulates wrong-user graph path)
    mockRunRead.mockResolvedValue([]);
    mockRunWrite.mockResolvedValue([]);
  });

  test("NS_SEC_05: GET [memoryId] with wrong user → 404 (empty graph path)", async () => {
    // Import route handler
    const { GET } = await import(
      "@/app/api/v1/memories/[memoryId]/route"
    );
    const req = makeMockRequest({
      searchParams: { user_id: "userA" },
    }) as any;
    const params = { params: Promise.resolve({ memoryId: "userB-memory-1" }) };
    const response = await GET(req, params);
    // When graph returns nothing (wrong user path), route must return 404
    expect(response.status).toBe(404);
  });

  test("NS_SEC_06: GET [memoryId]/related with wrong user → 404 (empty graph path)", async () => {
    const { GET } = await import(
      "@/app/api/v1/memories/[memoryId]/related/route"
    );
    const req = makeMockRequest({
      searchParams: { user_id: "userA" },
    }) as any;
    const params = { params: Promise.resolve({ memoryId: "userB-memory-1" }) };
    const response = await GET(req, params);
    // Related memories for a non-owned memory = empty list (not 404)
    // But the primary memory ownership check must prevent exposing related memories
    // After fix: when memory owner check fails → 404
    expect(response.status).toBe(404);
  });
});
