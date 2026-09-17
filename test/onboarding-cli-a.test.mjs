// Register independent onboarding CLI cases in a separate test worker so the
// fast gate retains coverage without serializing unrelated command fixtures.
await import('./onboarding-product-flow.test.mjs?part=cli-a');
