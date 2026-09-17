// Register independent prune safety cases in a separate test worker so the
// fast gate keeps complete coverage without serializing unrelated fixtures.
await import('./sync-prune.test.mjs?part=prune-safety');
