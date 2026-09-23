// A random per-browser id sent to the backend as X-Device-Id on every request.
// The server applies usage limits per device as well as per account, so a
// second account (or a fresh guest session after signing out) on the same
// browser shares one budget instead of getting a new one.
//
// Best-effort by design: it is kept in localStorage AND a first-party cookie,
// and each copy restores the other, so clearing only one does not reset it.
// Clearing all site data or using a private window does. Never scoped per user
// (unlike scopeKey) and never cleared on sign-out: it identifies the browser,
// not the account.

const STORAGE_KEY = "nosey_device_id";
const COOKIE_NAME = "nosey_did";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 400; // browsers cap cookies near 400 days

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let cached: string | null = null;

function readStorage(): string | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value && UUID_RE.test(value) ? value : null;
  } catch {
    return null;
  }
}

function readCookie(): string | null {
  try {
    const match = document.cookie.split("; ").find((part) => part.startsWith(`${COOKIE_NAME}=`));
    const value = match ? decodeURIComponent(match.slice(COOKIE_NAME.length + 1)) : null;
    return value && UUID_RE.test(value) ? value : null;
  } catch {
    return null;
  }
}

function persist(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Storage blocked: the cookie (or the in-memory copy) still carries it.
  }
  try {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${COOKIE_NAME}=${encodeURIComponent(id)}; Max-Age=${COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax${secure}`;
  } catch {
    // Cookies blocked: localStorage still carries it.
  }
}

function generate(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // RFC 4122 v4 fallback for older browsers.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function getDeviceId(): string {
  if (cached) return cached;
  const id = readStorage() ?? readCookie() ?? generate();
  persist(id); // re-sync both copies every session
  cached = id;
  return id;
}
