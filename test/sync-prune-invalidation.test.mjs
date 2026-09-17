// Register approval invalidation cases in a separate worker so every binding
// remains covered without serial execution in the fast suite.
await import('./sync-prune.test.mjs?part=prune-invalidation');
