// @ts-check

/** @type {import("prettier").Config} */
const config = {
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
  semi: true,
  singleQuote: false,
  quoteProps: "as-needed",
  jsxSingleQuote: false,
  trailingComma: "all",
  bracketSpacing: true,
  bracketSameLine: false,
  arrowParens: "always",
  endOfLine: "lf",
  overrides: [
    {
      files: ["*.json", "*.jsonc"],
      options: {
        printWidth: 80,
      },
    },
    {
      files: ["*.md", "*.mdx"],
      options: {
        printWidth: 80,
        proseWrap: "always",
      },
    },
  ],
};

export default config;
