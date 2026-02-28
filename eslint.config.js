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

  // CommonJS files — Node.js globals (require, module, console, process, etc.)
  {
    files: ["**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        require: "readonly",
        module: "readonly",
        exports: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        process: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        Buffer: "readonly",
        global: "readonly",
      },
    },
    rules: {
      // require() is the standard CJS import mechanism
      "@typescript-eslint/no-require-imports": "off",
      // Allow empty catch blocks in benchmark scripts (expected errors)
      "no-empty": ["error", { allowEmptyCatch: true }],
      // Allow unused vars prefixed with _
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },

  // Plain JS config files (jest.config.js etc.) — Node.js globals
  {
    files: ["**/*.js"],
    languageOptions: {
      globals: {
        module: "readonly",
        exports: "readonly",
        require: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        process: "readonly",
        console: "readonly",
      },
    },
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
