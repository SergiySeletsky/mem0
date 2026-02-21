// Manual mock entry-point for neo4j-driver (pnpm junction resolution on Windows)
// Tests override this via jest.mock("neo4j-driver", factory)
// This file just needs to exist so Jest can resolve the path.

export default {
  driver: jest.fn(),
  auth: { basic: jest.fn() },
  integer: { toNumber: (n: any) => (typeof n === "object" ? (n.low ?? n) : n) },
  types: { Node: class {}, Relationship: class {} },
};
