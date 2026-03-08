import js from "@eslint/js";
import pluginSecurity from "eslint-plugin-security";
import globals from "globals";

export default [
  js.configs.recommended,
  pluginSecurity.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.worker
      }
    }
  }
];