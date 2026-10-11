import { describe, expect, it } from "vitest";

// A budget gate that compares a constant to itself proves nothing. This one measures the running
// service, fails closed when the API is unreachable, and fails when the measured budget is exceeded.
const API = process.env.AICG_LIVE_API ?? "http://127.0.0.1:3103";
const ORGANIZATION =
  process.env.AICG_LIVE_ORGANIZATION ?? "11111111-1111-1111-1111-111111111111";
const SAMPLES = Number(process.env.AICG_LIVE_PERF_SAMPLES ?? 30);
const BUDGET_MS = Number(process.env.AICG_LIVE_PERF_BUDGET_MS ?? 250);

describe("performance budgets", () => {
  it("keeps the board query inside its latency budget with no failed requests", async () => {
    const target = `${API}/boards?organizationId=${ORGANIZATION}`;
    let reachable = true;
    try {
      await fetch(target, { signal: AbortSignal.timeout(5000) });
    } catch {
      reachable = false;
    }
    expect(reachable, `this gate requires a running API at ${API}`).toBe(true);

    const timings: number[] = [];
    let failures = 0;
    for (let index = 0; index < SAMPLES; index += 1) {
      const started = performance.now();
      try {
        const response = await fetch(target, {
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) failures += 1;
        await response.text();
      } catch {
        failures += 1;
      }
      timings.push(performance.now() - started);
    }
    timings.sort((left, right) => left - right);
    const p95 =
      timings[Math.min(timings.length - 1, Math.floor(timings.length * 0.95))];
    expect(failures, "no request may fail").toBe(0);
    expect(
      p95,
      `p95 ${p95.toFixed(1)}ms exceeds the ${BUDGET_MS}ms budget`,
    ).toBeLessThanOrEqual(BUDGET_MS);
  });
});
