// Register the isolated retention cases in a separate test worker so the fast
// gate keeps complete prune coverage without serializing unrelated fixtures.
await import('./sync-prune.test.mjs?part=retention');
