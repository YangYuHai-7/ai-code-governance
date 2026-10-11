// Flat ESLint configuration (ESLint 9 requires it). It lints the repository scripts; TypeScript
// sources are covered by the typecheck and architecture gates, which the same quality matrix runs.
export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  {
    files: ["**/*.mjs", "**/*.js"],
    languageOptions: { ecmaVersion: 2024, sourceType: "module" },
    linterOptions: { reportUnusedDisableDirectives: true },
    rules: {
      "no-unused-vars": "error",
      "no-constant-condition": "error",
      eqeqeq: "error",
      "no-undef": "off",
    },
  },
];
