import js from "@eslint/js";
import globals from "globals";
import { defineConfig } from "eslint/config";

export default defineConfig([
  {
    files: ["js/**/*.js"],
    ignores: ["js/search-worker.js"],
    plugins: { js },
    extends: ["js/recommended"],
    languageOptions: { globals: { ...globals.browser, Chart: "readonly" }, sourceType: "script" },
  },
  {
    files: ["js/search-worker.js"],
    plugins: { js },
    extends: ["js/recommended"],
    languageOptions: { globals: { ...globals.browser, ...globals.webworker }, sourceType: "script" },
  },
  {
    files: ["*.js", "bench/**/*.js"],
    plugins: { js },
    extends: ["js/recommended"],
    languageOptions: { globals: globals.node, sourceType: "commonjs" },
  },
  {
    files: ["bench/build-history-html-bench.js"],
    languageOptions: { globals: { buildHistoryHTML: "readonly" } },
  },
]);
