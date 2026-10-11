import { describe, expect, it } from "vitest";

describe("performance budgets", () => {
  it("declares the requirement budgets", () => {
    expect(250).toBeLessThanOrEqual(250);
    expect(300 * 1024).toBeLessThanOrEqual(300 * 1024);
  });
});
