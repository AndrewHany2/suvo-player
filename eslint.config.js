// Focused ESLint baseline. Deliberately narrow: it enforces the React Hooks
// rules (the exact bug class hand-fixed in recent commits — incomplete deps,
// conditional hooks) without drowning 140+ platform-forked files in stylistic
// noise. Expand rule coverage incrementally. Prettier is intentionally not wired
// yet (its reformat would swamp the diff).
const reactHooks = require("eslint-plugin-react-hooks");
const globals = require("globals");

module.exports = [
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "tv/dist/**",
      "tv/packaging/**",
      "android/**",
      "ios/**",
      ".expo/**",
      "mocks/**",
    ],
  },
  {
    // JS/JSX only — the Deno .ts edge functions use TS syntax espree can't parse.
    files: ["**/*.{js,jsx}"],
    plugins: { "react-hooks": reactHooks },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        ...globals.browser,
        ...globals.node,
        __DEV__: "readonly",
      },
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
];
