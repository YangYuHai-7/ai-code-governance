import { defineConfig } from 'vitest/config';

// The evaluation harness runs the fixture with its own toolchain; vitest picks up the named suites.
export default defineConfig({
  test: {
    include: [
      'tests/**/*.unit.ts',
      'tests/**/*.integration.ts',
      'tests/**/*.contract.ts',
      'tests/**/*.security.ts',
      'tests/**/*.observability.ts',
      'tests/**/*.performance.ts',
    ],
    environment: 'node',
  },
});
