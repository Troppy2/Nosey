import { narrateText } from "./api";

/** Voices the server narrates with. Lessons, notes and slide decks use the host voice. */
export const NARRATION_VOICE = "af_heart";
export const EXPERT_VOICE = "bm_george";

/** Longest chunk sent per request (the server accepts 1500). Fewer, longer clips mean fewer requests. */
export const NARRATION_CHUNK_CHARS = 600;

export const narrationSupported = () => typeof window !== "undefined" && typeof Audio !== "undefined";

type Clip = { text: string; voice: string; rate: number; onStart?: () => void; onEnd?: () => void; onError?: () => void };

const cache = new Map<string, Promise<Blob>>();
let audio: HTMLAudioElement | null = null;
let url: string | null = null;
let run = 0;

function fetchClip(text: string, voice: string): Promise<Blob> {
  const key = `${voice}|${text}`;
  let hit = cache.get(key);
  if (!hit) {
    // The server already tried Kokoro then Fish, so no retry here: a failure goes straight to
    // the browser voice, and the clip is dropped from the cache so a later play tries again.
    hit = narrateText(text, voice).catch((e: unknown) => {
      cache.delete(key);
      throw e;
    });
    cache.set(key, hit);
    if (cache.size > 24) cache.delete(cache.keys().next().value as string);
  }
  return hit;
}

/** Warms the next clip so playback does not stall between chunks. */
export function prefetchNarration(text: string | undefined, voice: string) {
  if (text) void fetchClip(text, voice).catch(() => undefined);
}

export function cancelNarration() {
  run += 1;
  audio?.pause();
  audio = null;
  if (url) URL.revokeObjectURL(url);
  url = null;
  if (typeof window !== "undefined") window.speechSynthesis?.cancel();
}

/** Speaks one chunk. Starting a new one cancels the last. If the server voice is down the browser voice takes over. */
export function speakNarration({ text, voice, rate, onStart, onEnd, onError }: Clip) {
  cancelNarration();
  const mine = run;
  fetchClip(text, voice)
    .then((blob) => {
      if (mine !== run) return;
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
      if (mine !== run) return;
      const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
      if (!synth) return onError?.();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = rate;
      u.onstart = () => mine === run && onStart?.();
      u.onend = () => mine === run && onEnd?.();
      u.onerror = () => mine === run && onError?.();
      synth.speak(u);
    });
}
