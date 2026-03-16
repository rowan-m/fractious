import js from "@eslint/js";
import pluginSecurity from "eslint-plugin-security";
import pluginNoUnsanitized from "eslint-plugin-no-unsanitized";
import globals from "globals";

export default [
  js.configs.recommended,
  pluginSecurity.configs.recommended,
  pluginNoUnsanitized.configs.recommended,
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
      "security/detect-object-injection": "error",
      "security/detect-non-literal-regexp": "error",
      "security/detect-unsafe-regex": "error",
      "security/detect-buffer-noassert": "error",
      "security/detect-eval-with-expression": "error",
      "no-unsanitized/method": "error",
      "no-unsanitized/property": "error"
    }
  }
];