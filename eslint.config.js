// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // Base recommended rules
  eslint.configs.recommended,
  ...tseslint.configs.recommended,

  // Global ignores
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/out/**",
      "**/build/**",
      "**/coverage/**",
      "pnpm-lock.yaml",
    ],
  },

  // TypeScript-specific overrides
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      // Allow unused vars prefixed with _ (common TS pattern)
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Allow explicit `any` with a warning rather than an error
      "@typescript-eslint/no-explicit-any": "warn",
      // Allow empty object types (common in lib code)
      "@typescript-eslint/no-empty-object-type": "off",
    },
  },

  // Next.js app — use eslint-config-next for the UI workspace
  // Run `pnpm --filter my-v0-project add -D eslint-config-next` if not already present,
  // then the openmemory/ui/ directory can have its own eslint.config.mjs that extends this.
  {
    files: ["openmemory/ui/**/*.ts", "openmemory/ui/**/*.tsx"],
    rules: {
      // Next.js pages use default exports; relax this rule for the UI
      "import/no-default-export": "off",
    },
  },

  // Test files — allow require() for jest dynamic mock factories and lazy loading patterns
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.spec.tsx"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      // Test files use explicit any extensively for mocking
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
