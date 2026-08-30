// Backend reachability tracker for the Render free tier.
//
// Render spins the backend down after a period without traffic, so the
// frontend can render fine while every API call silently fails. This module
// owns one source of truth for "is the server actually reachable?" and lets
// the app swap to a waiting screen instead of showing broken pages.
//
// Keep BACKEND_API_BASE_URL in sync with API_BASE_URL in api.ts (the duplicate
// exists on purpose; api.ts imports from here, so importing back would create
// a circular module dependency).

export const BACKEND_API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "https://noesy.onrender.com";

// "down"      : server unreachable, waiting screen is showing
// "recovered" : server is back up after a "down" period; the waiting screen
//               stays until the user confirms, so they can return to the app
// "up"        : normal operation
export type BackendStatus = "up" | "down" | "recovered";

// Probe cadence per state. While down we poll fast so the user is let back in
// within seconds of the server finishing its boot; while up we re-check every
// 5 minutes. Downtime is also detected instantly from API responses (see
// reportBackendHttpFailure), so the periodic probe is a backstop, not the only
// detector.
const POLL_MS: Record<Exclude<BackendStatus, "recovered">, number> = {
  up: 5 * 60 * 1000,
  down: 25 * 1000,
};

// A spin-up on the free tier can take a while, so the probe allows 10s before
// declaring the server unreachable.
const PROBE_TIMEOUT_MS = 10_000;

let status: BackendStatus = "up";
let watcherStarted = false;
let probeInFlight = false;
let probeTimer: number | undefined;

// Debounce for failure reports. A single transient blip on one API call (a
// dropped packet, a stalled connection) must not immediately cover the whole
// app with the waiting screen. We only commit to "down" once TWO failures land
// within DEBOUNCE_MS, so a lone blip self-heals without ever mounting the
// overlay. The /health probe remains the authoritative source and flips to
// "down" directly on a negative result.
const DEBOUNCE_MS = 4000;
let failureTimer: number | undefined;
let failureCount = 0;

type Listener = (status: BackendStatus) => void;
const listeners = new Set<Listener>();

function setStatus(next: BackendStatus) {
  if (next === status) return;
  status = next;
  listeners.forEach((cb) => cb(status));
}

export function getBackendStatus(): BackendStatus {
  return status;
}

export function subscribeBackendStatus(cb: Listener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

async function probeHealth(): Promise<boolean> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(`${BACKEND_API_BASE_URL}/health`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

// Runs one probe and applies the resulting state. The recovery transition is
// "down" -> "recovered" (never straight back to "up") so the waiting screen can
// greet the user instead of silently swapping mid-game.
export async function checkBackendNow(): Promise<BackendStatus> {
  if (probeInFlight) return status;
  probeInFlight = true;
  try {
    const healthy = await probeHealth();
    const next: BackendStatus = healthy ? (status === "down" ? "recovered" : "up") : "down";
    setStatus(next);
    return next;
  } finally {
    probeInFlight = false;
  }
}

function scheduleNextProbe() {
  if (probeTimer !== undefined) window.clearTimeout(probeTimer);
  const delay = status === "recovered" ? POLL_MS.up : POLL_MS[status];
  probeTimer = window.setTimeout(() => {
    void checkBackendNow().then(scheduleNextProbe);
  }, delay);
}

// Idempotent. Call once from the app root. Starts the boot probe, keeps the
// 5-minute background check alive, and re-probes immediately when the tab
// becomes visible again (background tabs get their timers throttled, which
// would otherwise delay recovery detection).
export function startBackendWatcher() {
  if (watcherStarted) return;
  watcherStarted = true;
  void checkBackendNow();
  scheduleNextProbe();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && (status === "down" || status === "recovered")) {
      void checkBackendNow();
    }
  });
}

// A response with any of these statuses means the deployment is not serving the
// app: Render's proxy answers 502/503/504 while a free-tier instance is waking
// up. A status code alone never flips the app to "down": the app itself can
// return 503 legitimately (an LLM provider failure maps to it), so every report
// kicks a /health probe and that probe is the authoritative source. The debounce
// prevents a single transient blip from covering the whole app, and the probe
// clears a healthy result (app is fine, only a packet dropped) in about a
// second.
const SERVER_DOWN_HTTP_STATUS = new Set([502, 503, 504]);

// Debounced: requires two reports within DEBOUNCE_MS before mounting the
// waiting screen, so a lone blip self-heals without the overlay ever mounting.
// Every report also kicks a re-probe, so a healthy server drops straight back
// to normal handling.
function reportFailure(markDownImmediately: boolean) {
  failureCount += 1;
  if (failureTimer !== undefined) window.clearTimeout(failureTimer);
  failureTimer = window.setTimeout(() => {
    failureCount = 0;
  }, DEBOUNCE_MS);

  if (failureCount >= 2 && status === "up") {
    if (failureTimer !== undefined) window.clearTimeout(failureTimer);
    failureCount = 0;
    if (markDownImmediately) setStatus("down");
  }
  void checkBackendNow();
}

// Called by api.ts when a request fails at the network level (fetch threw,
// never got an HTTP response). There is no doubt the server is unreachable, so
// on a confirmed double-failure we flip immediately and let the re-probe sort
// out recovery.
export function reportBackendNetworkFailure() {
  reportFailure(true);
}

// Called by api.ts when a request did get an HTTP response but the status says
// the deployment is not serving the app (502/503/504, see
// SERVER_DOWN_HTTP_STATUS). We never flip straight to "down" from a status
// code alone because the app generates its own 503s (LLM provider failures);
// the follow-up /health probe is the final word and mounts the waiting screen
// only when it also fails.
export function reportBackendHttpFailure(statusCode: number) {
  if (!SERVER_DOWN_HTTP_STATUS.has(statusCode)) return;
  reportFailure(false);
}

// Called from the waiting screen's "Take me back" action. The user has
// acknowledged recovery, so we jump straight back to the normal app without
// forcing a full page reload (the watcher keeps the 5-minute cadence running).
export function dismissBackendRecovery() {
  setStatus("up");
  scheduleNextProbe();
}