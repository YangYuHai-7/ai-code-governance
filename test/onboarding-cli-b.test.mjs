// Register independent architecture and rescan CLI cases in a separate test
// worker so slower command fixtures do not define the fast-suite latency.
await import('./onboarding-product-flow.test.mjs?part=cli-b');
