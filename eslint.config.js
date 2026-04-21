// ESLint flat-config for terminal-talk.
//
// S2 of the v0.4 quality tier (see Claude Assesments/v0.4-QUALITY-ULTRAPLAN.md).
// Uses the modern flat-config form (ESLint 9+, eslint.config.js at repo root).
//
// Scope:
//   - app/        Electron main + renderer + lib modules (Node or browser globals)
//   - scripts/    CLI tooling (Node globals)
//   - docs/ui-kit Kit demo (browser globals; mock-ipc runs in browser)
//
// Ignored: generated files (tokens-window.js, palette-classes.css,
// voices-window.js, tokens.mjs), the app-mirror (copy of app/ for Pages),
// test baselines, node_modules.

'use strict';

const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  // Global ignores — applied to every lint invocation.
  {
    ignores: [
      '**/node_modules/**',
      'tests/baselines/**',
      'docs/app-mirror/**',
      // Generated files — tracked but not hand-edited.
      'app/lib/tokens-window.js',
      'app/lib/voices-window.js',
      'app/lib/palette-classes.css',
      'docs/ui-kit/tokens.mjs',
      'docs/colors_and_type.css',
      // Windows scripts
      '**/*.ps1',
      '**/*.psm1',
      // Python
      '**/*.py',
      // Test output dirs
      '.tmp-mocks/',
      '.tmp-pixel-diff/',
      '.scannerwork/',
      'coverage/',
      'playwright-report/',
      'test-results/',
    ],
  },

  // Baseline recommended rules for every JS file.
  js.configs.recommended,

  // Electron main process + CommonJS scripts — Node globals.
  {
    files: [
      'app/main.js',
      'app/preload.js',
      'app/lib/*.js',
      'scripts/**/*.cjs',
      'scripts/**/*.js',
      'eslint.config.js',
    ],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // `catch {}` is idiomatic in this codebase for best-effort FS ops
      // where we don't care if the unlink/read fails. Allow only empty
      // catches; other empty blocks still flagged (usually real bugs).
      'no-empty': ['error', { allowEmptyCatch: true }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'warn',
      'no-implicit-globals': 'error',
      'no-param-reassign': ['warn', { props: false }],
      'no-console': 'off', // We use diag() and console.error intentionally.
    },
  },

  // Electron renderer + kit demo — browser globals, plus window.api
  // bridge exposed by preload.
  //
  // The UMD-lite lib files (clip-paths, component, stale-session-poller)
  // live in both worlds: Node (unit tests via require) and browser
  // (loaded by index.html via <script>). Lint them under the browser
  // block because their heaviest runtime surface (DOM, timers, RAF) is
  // browser-side; the `typeof module === 'object'` guard at the top of
  // each file keeps Node happy without tripping no-undef on `module`
  // (ESLint special-cases `typeof X` as non-reference).
  {
    files: [
      'app/renderer.js',
      'app/lib/clip-paths.js',
      'app/lib/component.js',
      'app/lib/stale-session-poller.js',
      'app/lib/dot-strip.js',
      'app/lib/sessions-table.js',
      'docs/ui-kit/**/*.js',
    ],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        // Custom globals provided by preload + generated token scripts
        TT_TOKENS: 'readonly',
        TT_VOICES: 'readonly',
        api: 'readonly', // window.api from preload.js
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // `catch {}` is idiomatic in this codebase for best-effort FS ops
      // where we don't care if the unlink/read fails. Allow only empty
      // catches; other empty blocks still flagged (usually real bugs).
      'no-empty': ['error', { allowEmptyCatch: true }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'warn',
      'no-implicit-globals': 'off', // renderer uses top-level vars from tokens-window
      'no-param-reassign': ['warn', { props: false }],
      'no-console': 'off',
    },
  },
];
