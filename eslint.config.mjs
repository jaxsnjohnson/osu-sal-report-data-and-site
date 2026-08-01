import js from "@eslint/js";
import globals from "globals";
import { defineConfig } from "eslint/config";

export default defineConfig([
  {
    // Browser JS files
    files: ["js/**/*.js"],
    ignores: ["js/search-worker.js"],
    plugins: { js },
    extends: ["js/recommended"],
    languageOptions: {
      globals: { ...globals.browser, Chart: "readonly" },
      sourceType: "script",
    },
    rules: {
      "no-unused-vars": "warn",
      "no-useless-escape": "warn",
    },
  },
  {
    // Web Worker
    files: ["js/search-worker.js"],
    plugins: { js },
    extends: ["js/recommended"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.webworker },
      sourceType: "script",
    },
    rules: {
      "no-unused-vars": "warn",
      "no-useless-escape": "warn",
    },
  },
  {
    // Node.js scripts (including root .js files and bench directory)
    files: ["*.js", "bench/**/*.js"],
    plugins: { js },
    extends: ["js/recommended"],
    languageOptions: {
      globals: globals.node,
      sourceType: "commonjs",
    },
    rules: {
      "no-unused-vars": "warn",
      "no-useless-escape": "warn",
    },
  },
  {
    // Specific global override for benchmark HTML builder
    files: ["bench/build-history-html-bench.js"],
    languageOptions: {
      globals: { buildHistoryHTML: "readonly" },
    },
  },
]);