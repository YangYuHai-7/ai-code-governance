#!/usr/bin/env node

import { run } from '../src/cli.mjs';

run(process.argv.slice(2)).catch((error) => {
  const prefix = error.code === 'AICG_USAGE' ? 'Usage error' : 'Error';
  console.error(`${prefix}: ${error.message}`);
  process.exitCode = error.exitCode ?? (error.code === 'AICG_USAGE' ? 2 : 1);
});
