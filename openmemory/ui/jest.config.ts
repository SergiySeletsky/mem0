import type { JestConfigWithTsJest as Config } from "ts-jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: ".",
  testMatch: ["<rootDir>/tests/**/*.test.ts"],
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
