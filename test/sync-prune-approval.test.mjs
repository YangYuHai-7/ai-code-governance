// Register approval replay cases in a separate worker so repeated CLI
// processes do not define the fast-suite latency.
await import('./sync-prune.test.mjs?part=prune-approval');
