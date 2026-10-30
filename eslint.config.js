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
  {
    // Nothing calls OregonAI while serving (ADR-0004, ADR-0012). Production code has no network but the
    // `fetch` it is given (src/CLAUDE.md, "Dependencies are passed in"): the entry scripts under src/bin/
    // make it once and pass it down, so only they may name the global. The scope is every file of src/
    // rather than the files the server reaches today, so a package the server comes to import is covered.
    // `.dependency-cruiser.cjs` forbids the built-in modules that open connections.
    files: ["src/**/*.ts"],
    ignores: ["src/bin/**", "src/**/tests/**"],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "fetch", message: "Take the `fetch` the entry script was given; only src/bin/ names the global." },
        { name: "WebSocket", message: "Production code opens no sockets of its own." },
      ],
      "no-restricted-properties": [
        "error",
        ...["globalThis", "global"].flatMap((object) =>
          ["fetch", "WebSocket"].map((property) => ({
            object,
            property,
            message: "Take the `fetch` the entry script was given; only src/bin/ names the global.",
          })),
        ),
        {
          object: "process",
          property: "getBuiltinModule",
          message: "Import a built-in by name, so that `npm run lint:boundaries` sees it.",
        },
      ],
      "@typescript-eslint/no-restricted-imports": [
        "error",
        ...["node:http", "http"].map((name) => ({
          name,
          allowImportNames: ["createServer"],
          allowTypeImports: true,
          message: "node:http is for createServer alone (http.ts); its request and get are clients.",
        })),
      ],
    },
  },
);
