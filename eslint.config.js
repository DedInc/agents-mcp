// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config([
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Allow explicit `as const` type assertions
      "@typescript-eslint/no-unnecessary-type-assertion": "warn",
      // Prefer nullish coalescing where applicable
      "@typescript-eslint/prefer-nullish-coalescing": "warn",
      // Consistent type imports
      "@typescript-eslint/consistent-type-imports": ["warn", { prefer: "type-imports" }],
      // No floating promises
      "@typescript-eslint/no-floating-promises": "error",
    },
  },
]);
