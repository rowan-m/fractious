import js from "@eslint/js";
import sonarjs from "eslint-plugin-sonarjs";
import globals from "globals";

export default [
  js.configs.recommended,
  sonarjs.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.worker
      }
    },
    rules: {
      "sonarjs/no-duplicate-string": "warn",
      "sonarjs/cognitive-complexity": ["warn", 30]
    }
  }
];