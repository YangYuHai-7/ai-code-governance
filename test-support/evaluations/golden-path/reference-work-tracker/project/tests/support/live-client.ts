// The operator must provision this token in TRACKER_SESSIONS on the running API.
export function liveFetch(input: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set(
    "authorization",
    `Bearer ${process.env.AICG_LIVE_SESSION_TOKEN ?? ""}`,
  );
  return fetch(input, { ...init, headers });
}
