// ESLint 10 flat config. typescript-eslint's strictTypeChecked set, plus the two rules ADR-0008
// and docs/research/typescript-toolchain.md section 5.2 want that no preset includes.
// typescript-eslint reads `typescript` (the TypeScript 6 alias, ADR-0008) for type information.
import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/strict-boolean-expressions": "error",
      // strictTypeChecked rejects a number in a template string. A count or an id in a message is
      // ordinary and cannot hide a bug the way an object ("[object Object]") or an undefined
      // ("undefined") can, so numbers are allowed and every other type stays rejected.
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
    },
  },
);
