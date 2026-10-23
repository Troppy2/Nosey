import { narrateText } from "./api";

/** Voices the server narrates with. Lessons, notes and slide decks use the host voice. */
export const NARRATION_VOICE = "af_heart";
export const EXPERT_VOICE = "bm_george";

/** Longest chunk sent per request (the server accepts 1500). Fewer, longer clips mean fewer requests. */
export const NARRATION_CHUNK_CHARS = 600;

/**
 * How long a chunk may wait for its saved clip before the browser voice reads it instead. Saved
 * clips come back in milliseconds, so this only triggers while the server is still generating one.
 */
const WAIT_FOR_CLIP_MS = 2500;

export const narrationSupported = () => typeof window !== "undefined" && typeof Audio !== "undefined";

type Clip = {
  text: string;
  voice: string;
  rate: number;
  /** A voice from the device's own text to speech (not AI). When set, nothing is fetched. */
  deviceVoice?: SpeechSynthesisVoice | null;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: () => void;
};

// ── On-device cache ───────────────────────────────────────────────────────────
// A heard clip is kept in the browser's Cache Storage, so replays, seeking back and returning
// tomorrow are instant and offline. (localStorage holds about 5 MB, a few lessons of audio;
// Cache Storage is the same idea with room for hundreds.)
// Bump the version when stored audio quality changes, so old clips are not kept.
const DEVICE_CACHE = "nosey-narration-v2";
const DEVICE_CACHE_MAX = 400;

async function deviceKey(voice: string, text: string): Promise<string | null> {
  if (typeof crypto === "undefined" || !crypto.subtle) return null;
  const bytes = new TextEncoder().encode(text.trim());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return `/__narration/${voice}/${hex}`;
}

async function readDevice(key: string | null): Promise<Blob | null> {
  if (!key || typeof caches === "undefined") return null;
  try {
    const hit = await (await caches.open(DEVICE_CACHE)).match(key);
    return hit ? await hit.blob() : null;
  } catch {
    return null;
  }
}

async function writeDevice(key: string | null, blob: Blob) {
  if (!key || typeof caches === "undefined") return;
  try {
    const cache = await caches.open(DEVICE_CACHE);
    await cache.put(key, new Response(blob, { headers: { "Content-Type": blob.type || "audio/mpeg" } }));
    const keys = await cache.keys();
    // Oldest first, so the least recently stored clips go when the cap is passed.
    for (const old of keys.slice(0, Math.max(0, keys.length - DEVICE_CACHE_MAX))) await cache.delete(old);
  } catch {
    // Private mode or a full quota: the clip still plays, it just is not kept.
  }
}

// ── Clip loading ──────────────────────────────────────────────────────────────
const pending = new Map<string, Promise<Blob>>();
let audio: HTMLAudioElement | null = null;
let url: string | null = null;
let run = 0;

function fetchClip(text: string, voice: string): Promise<Blob> {
  const memo = `${voice}|${text}`;
  let hit = pending.get(memo);
  if (!hit) {
    // Device cache first, then the server (which reads its own saved clip or generates one). No
    // retry: the server already tried Kokoro then Fish, so a failure goes straight to the browser voice.
    hit = (async () => {
      const key = await deviceKey(voice, text);
      const stored = await readDevice(key);
      if (stored) return stored;
      const blob = await narrateText(text, voice);
      void writeDevice(key, blob);
      return blob;
    })().catch((e: unknown) => {
      pending.delete(memo);
      throw e;
    });
    pending.set(memo, hit);
    if (pending.size > 24) pending.delete(pending.keys().next().value as string);
  }
  return hit;
}

/** Warms clips ahead of playback so they are ready (or at least generating) before they are needed. */
export function prefetchNarration(text: string | undefined, voice: string) {
  if (text) void fetchClip(text, voice).catch(() => undefined);
}

export function prefetchMany(texts: (string | undefined)[], voice: string) {
  for (const text of texts) prefetchNarration(text, voice);
}

export function cancelNarration() {
  run += 1;
  audio?.pause();
  audio = null;
  if (url) URL.revokeObjectURL(url);
  url = null;
  if (typeof window !== "undefined") window.speechSynthesis?.cancel();
}

/**
 * Speaks one chunk. The saved clip plays when it is ready; if it is not back within a moment (the
 * server is still generating it) the browser voice reads this chunk so there is never a dead wait,
 * and the clip keeps loading so the next chunk can use it. Starting a new chunk cancels the last.
 */
export function speakNarration({ text, voice, rate, deviceVoice, onStart, onEnd, onError }: Clip) {
  cancelNarration();
  const mine = run;
  let usedBrowser = false;

  const startBrowser = () => {
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    if (!synth) return onError?.();
    usedBrowser = true;
    const u = new SpeechSynthesisUtterance(text);
    u.rate = rate;
    if (deviceVoice) u.voice = deviceVoice;
    u.onstart = () => mine === run && onStart?.();
    u.onend = () => mine === run && onEnd?.();
    u.onerror = () => mine === run && onError?.();
    synth.speak(u);
  };

  // A chosen device voice is instant and needs no clip.
  if (deviceVoice) return startBrowser();

  const timer = window.setTimeout(() => {
    if (mine === run) startBrowser();
  }, WAIT_FOR_CLIP_MS);

  fetchClip(text, voice)
    .then((blob) => {
      window.clearTimeout(timer);
      if (mine !== run || usedBrowser) return;
      url = URL.createObjectURL(blob);
      const el = new Audio(url);
      audio = el;
      el.playbackRate = rate;
      el.onended = () => mine === run && onEnd?.();
      el.onerror = () => mine === run && onError?.();
      onStart?.();
      return el.play().catch(() => mine === run && onError?.());
    })
    .catch(() => {
      window.clearTimeout(timer);
      if (mine !== run || usedBrowser) return;
      startBrowser();
    });
}
