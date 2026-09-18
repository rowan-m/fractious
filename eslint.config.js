import js from '@eslint/js';
import sonarjs from 'eslint-plugin-sonarjs';
import pluginSecurity from 'eslint-plugin-security';
import pluginNoUnsanitized from 'eslint-plugin-no-unsanitized';
import globals from 'globals';

export default [
  js.configs.recommended,
  sonarjs.configs.recommended,
  pluginSecurity.configs.recommended,
  pluginNoUnsanitized.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.worker,
      },
    },
    rules: {
      'sonarjs/no-duplicate-string': ['error', { threshold: 5 }],
      'sonarjs/cognitive-complexity': ['error', 15],
      'sonarjs/no-identical-functions': 'error',
      'sonarjs/no-inverted-boolean-check': 'error',
      'sonarjs/prefer-single-boolean-return': 'error',
      'sonarjs/no-collapsible-if': 'error',
      'sonarjs/no-useless-catch': 'error',
      'sonarjs/prefer-immediate-return': 'error',
      'sonarjs/no-ignored-return': 'error',
      'sonarjs/no-all-duplicated-branches': 'error',
      'security/detect-object-injection': 'error',
      'security/detect-non-literal-regexp': 'error',
      'security/detect-unsafe-regex': 'error',
      'security/detect-buffer-noassert': 'error',
      'security/detect-eval-with-expression': 'error',
      'no-unsanitized/method': 'error',
      'no-unsanitized/property': 'error',
    },
  },
];
