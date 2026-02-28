import type { JestConfigWithTsJest as Config } from "ts-jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: ".",
  // Exclude e2e tests from the default run — they require a live server + Memgraph.
  // Run e2e separately via: pnpm test:e2e
  testMatch: [
    "<rootDir>/tests/unit/**/*.test.ts",
    "<rootDir>/tests/baseline/**/*.test.ts",
    "<rootDir>/tests/security/**/*.test.ts",
  ],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
    // pnpm symlinks on Windows / ESM-only packages: resolve via manual mocks
    "^uuid$": "<rootDir>/tests/__mocks__/uuid.ts",
    "^neo4j-driver$": "<rootDir>/tests/__mocks__/neo4j-driver.ts",
  },
  transform: {
    "^.+\\.tsx?$": ["ts-jest", {
      tsconfig: {
        paths: { "@/*": ["./*"] },
        module: "commonjs",
        esModuleInterop: true,
      },
    }],
  },
  testTimeout: 30000,
};

export default config;
