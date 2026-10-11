import { build } from 'vite';

// The API is bundled with the declared vite toolchain so its TypeScript sources stay the single
// source of truth while the runtime entry is plain ESM that node can execute.
await build({
  configFile: false,
  logLevel: 'error',
  build: {
    ssr: 'apps/api/src/main.ts',
    outDir: 'dist/api',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    rollupOptions: { output: { entryFileNames: 'main.js', format: 'es' }, external: ['fastify'] },
  },
});
process.stdout.write('api bundle written to dist/api/main.js\n');
