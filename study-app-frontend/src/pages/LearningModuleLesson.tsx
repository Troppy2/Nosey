import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Pause,
  Pencil,
  Play,
  RotateCcw,
  Video,
  Volume2,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { Button } from "../components/Button";
import { FormError } from "../components/FormError";
import { Card } from "../components/Card";
import { useConfetti } from "../components/Confetti";
import { InlineLoading, LoadingNotice } from "../components/Loaders";
import { MarkdownContent } from "../components/MarkdownContent";
import { SkeletonText } from "../components/Skeletons";
import {
  fetchTrackForModule,
  scopeKey,
  submitModuleQuiz,
  updateModuleLesson,
  updateModuleVideo,
} from "../lib/api";
import { markdownToSpeech, splitForSpeech } from "../components/episodeSpeech";
import { looksMangled, repairLessonMarkdown } from "../lib/repairLessonMarkdown";
import { isPermutationOf, shuffled, shuffledOptionOrder } from "../lib/shuffle";
import { useMobileShell } from "../lib/useMobileShell";
import { useSettings } from "../lib/useSettings";
import type { LearningTrack, QuizAttemptResult } from "../lib/types";

// Splits a markdown lesson into paragraph-level blocks (keeping fenced code
// blocks intact) so each block can be rendered separately and highlighted
// while the TTS reads it.
function splitLessonBlocks(markdown: string): string[] {
  const lines = markdown.split("\n");
  const blocks: string[] = [];
  let current: string[] = [];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (!inFence && line.trim() === "") {
      if (current.length) {
        blocks.push(current.join("\n"));
        current = [];
      }
    } else {
      current.push(line);
    }
  }
  if (current.length) blocks.push(current.join("\n"));
  return blocks;
}

// Content words used to align a spoken-script paragraph with the lesson
// paragraph it narrates. Short/function words are dropped so the overlap
// score reflects topic words, which survive the spoken rewrite.
function contentWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3),
  );
}

// Aligns script paragraphs to lesson blocks by word overlap, monotonically:
// each paragraph maps to the block (at or after the previous match, within a
// small lookahead window) that shares the most content words with it. This
// keeps the highlight on the paragraph actually being read even when the
// script merges headings into prose or skips code blocks, where a
// proportional index would run ahead.
function alignParagraphsToBlocks(paragraphs: string[], blocks: string[]): number[] {
  const blockWords = blocks.map(contentWords);
  const lookahead = 4;
  let cursor = 0;
  return paragraphs.map((paragraph) => {
    const words = contentWords(paragraph);
    let best = cursor;
    let bestScore = 0;
    const end = Math.min(blocks.length - 1, cursor + lookahead);
    for (let b = cursor; b <= end; b++) {
      let score = 0;
      for (const w of words) if (blockWords[b].has(w)) score++;
      // Normalize by block size so tiny blocks (headings) don't lose to
      // long blocks that match a few words by chance.
      const norm = score / Math.max(1, Math.min(words.size, blockWords[b].size));
      if (norm > bestScore) {
        bestScore = norm;
        best = b;
      }
    }
    // No meaningful overlap (e.g. a transition sentence): stay on the
    // current block rather than jumping.
    if (bestScore > 0.15) cursor = best;
    return cursor;
  });
}

// Turns a pasted video URL into an embeddable player source. YouTube and
// Vimeo pages cannot be iframed directly, so they map to their embed hosts;
// direct media files play in a <video> tag; anything else renders as a link.
function toVideoEmbed(url: string): { kind: "iframe" | "video" | "link"; src: string } {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
      const id = parsed.searchParams.get("v") ?? parsed.pathname.match(/\/(?:shorts|embed|live)\/([\w-]+)/)?.[1];
      if (id) return { kind: "iframe", src: `https://www.youtube-nocookie.com/embed/${id}` };
    }
    if (host === "youtu.be") {
      const id = parsed.pathname.slice(1).split("/")[0];
      if (id) return { kind: "iframe", src: `https://www.youtube-nocookie.com/embed/${id}` };
    }
    if (host === "vimeo.com") {
      const id = parsed.pathname.match(/\/(\d+)/)?.[1];
      if (id) return { kind: "iframe", src: `https://player.vimeo.com/video/${id}` };
    }
    if (host === "player.vimeo.com" || parsed.pathname.includes("/embed/")) {
      return { kind: "iframe", src: url };
    }
    if (/\.(mp4|webm|ogg|mov)(\?|$)/i.test(parsed.pathname)) {
      return { kind: "video", src: url };
    }
  } catch {
    /* fall through to link */
  }
  return { kind: "link", src: url };
}

type SpeechState = "idle" | "playing" | "paused";

// m:ss for the player readout. Rounds down so the clock never shows a total
// the narration has not reached yet.
function formatClock(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

// Playback speed is continuous, not a set of presets: 0.05 steps so someone who
// wants 1.7x can actually have it. The ceiling is 3x because Web Speech voices
// turn to mush above it on most platforms, and the floor is 0.5x because slower
// than that stops sounding like speech.
const RATE_MIN = 0.5;
const RATE_MAX = 3;
const RATE_STEP = 0.05;

// Trailing zeros dropped, so 1.7 reads "1.7x" and 1 reads "1x".
function formatRate(rate: number): string {
  return `${Number(rate.toFixed(2))}x`;
}

// ── Quiz display order + draft ───────────────────────────────────────────────
// The quiz is shuffled for display only. Question order and per-question option
// order are permutations OF CANONICAL INDICES, so grading, correct_indices and
// option_explanations all stay canonical and only rendering is remapped.

type QuizOrder = {
  questionOrder: number[];
  optionOrders: number[][];
};

type QuizDraft = QuizOrder & {
  // Canonical question index -> canonical option index.
  answers: Record<number, number>;
};

function quizDraftKey(moduleId: number): string {
  return scopeKey(`nosey_module_quiz_${moduleId}`);
}

function makeQuizOrder(quiz: { options: string[] }[]): QuizOrder {
  return {
    questionOrder: shuffled(quiz.map((_, i) => i)),
    optionOrders: quiz.map((question) => shuffledOptionOrder(question.options)),
  };
}

// Restores a saved draft only when it still fits the quiz on screen. A lesson
// edit regenerates quiz_json, so a stored order can outlive the questions it
// described; applying it would pair answers with the wrong questions. Any
// mismatch, or unreadable JSON, discards the draft.
function readQuizDraft(moduleId: number, quiz: { options: string[] }[]): QuizDraft | null {
  try {
    const raw = localStorage.getItem(quizDraftKey(moduleId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<QuizDraft>;

    if (!isPermutationOf(parsed.questionOrder, quiz.length)) return null;
    if (!Array.isArray(parsed.optionOrders) || parsed.optionOrders.length !== quiz.length) return null;
    for (let i = 0; i < quiz.length; i++) {
      if (!isPermutationOf(parsed.optionOrders[i], quiz[i].options.length)) return null;
    }

    const answers: Record<number, number> = {};
    for (const [key, value] of Object.entries(parsed.answers ?? {})) {
      const qIndex = Number(key);
      if (!Number.isInteger(qIndex) || qIndex < 0 || qIndex >= quiz.length) return null;
      if (!Number.isInteger(value) || value < 0 || value >= quiz[qIndex].options.length) return null;
      answers[qIndex] = value as number;
    }

    return {
      questionOrder: parsed.questionOrder,
      optionOrders: parsed.optionOrders as number[][],
      answers,
    };
  } catch {
    return null;
  }
}

// Normalises a lesson heading for matching: "## Why It Works" and
// "why it works" both reduce to the same key, so a model that drops or adds
// the hashes still resolves to the right block.
function headingKey(text: string): string {
  return text.replace(/^#+\s*/, "").replace(/[*_`]/g, "").trim().toLowerCase();
}

export default function LearningModuleLesson() {
  const { folderId, moduleId } = useParams();
  const numericFolderId = folderId ? Number(folderId) : null;
  const numericModuleId = moduleId ? Number(moduleId) : null;
  const { betaMode } = useSettings();
  // Drives the player's mobile layout off the SAME query the CSS uses, so the
  // markup and the styling can never disagree about which one is showing.
  const isMobileShell = useMobileShell();

  const [track, setTrack] = useState<LearningTrack | null>(null);
  const [loaded, setLoaded] = useState(false);
  // Keyed by CANONICAL question index (the order the quiz is stored in), never
  // by the shuffled display position. Everything sent to or received from the
  // server is canonical too, so only rendering goes through the permutations.
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [result, setResult] = useState<QuizAttemptResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Display order: questionOrder[displayPos] and optionOrders[qCanonical][displayPos]
  // both yield a canonical index. Null until the quiz loads and an order is
  // restored or generated.
  const [quizOrder, setQuizOrder] = useState<QuizOrder | null>(null);

  // Whole-track completion celebration: fired when the LAST module's quiz
  // passes and every other module is already passed.
  const { fire: fireConfetti, element: confettiElement } = useConfetti();

  // ── Article editing ─────────────────────────────────────────────────────────
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // ── Video resource ──────────────────────────────────────────────────────────
  const [videoFormOpen, setVideoFormOpen] = useState(false);
  const [videoDraft, setVideoDraft] = useState("");
  const [savingVideo, setSavingVideo] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);

  // ── Audio narration ─────────────────────────────────────────────────────────
  // The narration is a spoken rewrite of the article (notation in words), not
  // a word-for-word read, so it plays as a podcast-style audio player at the
  // top of the page rather than pretending to follow the text line by line.
  const ttsSupported = typeof window !== "undefined" && "speechSynthesis" in window;
  const [speech, setSpeech] = useState<SpeechState>("idle");
  // Persisted device-wide like the voice is: a continuous speed is a real
  // preference, and re-dialling 1.7x on every module would be tedious.
  const [rate, setRate] = useState(() => {
    if (typeof window === "undefined") return 1;
    const saved = Number(localStorage.getItem(scopeKey("nosey_lm_rate")));
    return Number.isFinite(saved) && saved >= RATE_MIN && saved <= RATE_MAX ? saved : 1;
  });
  // Position in the chunk queue: drives the progress bar and, persisted to
  // localStorage per module, lets the listener resume where they left off.
  const [chunkPos, setChunkPos] = useState(0);
  const [speedOpen, setSpeedOpen] = useState(false);
  const speedRef = useRef<HTMLDivElement | null>(null);
  // True while the quiz is on screen: the pill hides so it never sits on top of
  // the questions. Narration deliberately keeps playing.
  const [quizInView, setQuizInView] = useState(false);
  // State, not a ref: the effect below has to re-run when the section mounts or
  // unmounts (edit mode removes it), and a ref assignment does not re-render.
  const [quizNode, setQuizNode] = useState<HTMLElement | null>(null);
  const chunkIndexRef = useRef(0);
  const chunksRef = useRef<{ text: string; blockIndex: number }[]>([]);
  const stoppedRef = useRef(false);
  const rateRef = useRef(rate);
  // Chrome keeps firing onend/onerror for utterances that were cancelled, and
  // acting on those advances the queue while "paused" (audio keeps playing).
  // Every (re)start bumps the session; callbacks from older sessions no-op.
  const playSessionRef = useRef(0);

  const audioPosKey = numericModuleId != null ? scopeKey(`nosey_lm_audio_${numericModuleId}`) : "";

  // ── Narration voice ─────────────────────────────────────────────────────────
  // Voices come from the browser's speechSynthesis (Chrome ships Google
  // voices). The pick is device-wide, not per module.
  const [menuOpen, setMenuOpen] = useState(false);
  const [voiceFormOpen, setVoiceFormOpen] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceURI, setVoiceURI] = useState<string>(
    () => (typeof window !== "undefined" ? localStorage.getItem(scopeKey("nosey_lm_voice")) ?? "" : ""),
  );
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);

  // getVoices() is empty until the browser loads its list; voiceschanged fires
  // when it is ready (and again if the list updates).
  useEffect(() => {
    if (!ttsSupported) return;
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, [ttsSupported]);

  useEffect(() => {
    voiceRef.current = voices.find((v) => v.voiceURI === voiceURI) ?? null;
  }, [voices, voiceURI]);

  // English voices first (lessons are English), Google voices first within
  // that, so Chrome users see the good options at the top.
  const voiceOptions = useMemo(() => {
    return [...voices].sort((a, b) => {
      const aEn = a.lang.toLowerCase().startsWith("en") ? 0 : 1;
      const bEn = b.lang.toLowerCase().startsWith("en") ? 0 : 1;
      if (aEn !== bEn) return aEn - bEn;
      const aGoogle = a.name.includes("Google") ? 0 : 1;
      const bGoogle = b.name.includes("Google") ? 0 : 1;
      if (aGoogle !== bGoogle) return aGoogle - bGoogle;
      return a.name.localeCompare(b.name);
    });
  }, [voices]);

  useEffect(() => {
    if (numericModuleId == null) return;
    // Load the track that owns this module (active OR archived) so lessons from
    // an archived track still render; fetching by folder returns only the
    // active track.
    fetchTrackForModule(numericModuleId)
      .then(setTrack)
      .catch(() => setTrack(null))
      .finally(() => setLoaded(true));
  }, [numericModuleId]);

  // Start every module at the top of its article. Only :moduleId changes when
  // "Next module" is followed, so this component stays mounted and the browser
  // keeps the old scroll position, which would drop the reader straight into
  // the quiz they just came from. Instant, not smooth: this is a page change,
  // and animating a long article back to the top reads as a glitch.
  useEffect(() => {
    if (numericModuleId == null) return;
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [numericModuleId]);

  const module = useMemo(
    () => track?.modules.find((m) => m.id === numericModuleId) ?? null,
    [track, numericModuleId],
  );
  const moduleIndex = useMemo(
    () => (track && module ? track.modules.findIndex((m) => m.id === module.id) : -1),
    [track, module],
  );
  const nextModule =
    track && moduleIndex >= 0 && moduleIndex + 1 < track.modules.length
      ? track.modules[moduleIndex + 1]
      : null;

  const lessonBlocks = useMemo(
    () => (module?.lesson_content ? splitLessonBlocks(module.lesson_content) : []),
    [module?.lesson_content],
  );

  // The narration source: the LLM-written script when present (notation and
  // code already in words), otherwise the stripped lesson markdown for tracks
  // generated before scripts existed. markdownToSpeech runs on script
  // paragraphs too as a safety net against stray markdown or LaTeX.
  //
  // Each chunk carries the lesson block it narrates so the article can
  // highlight the paragraph currently being read: script paragraphs map to
  // blocks 1:1 when the counts line up and proportionally when they drift
  // (the script mirrors the lesson paragraph by paragraph, so this is
  // paragraph-accurate even though the wording is a spoken rewrite).
  const speechChunks = useMemo(() => {
    if (module?.tts_script) {
      const paragraphs = module.tts_script
        .split(/\n\s*\n/)
        .map((p) => markdownToSpeech(p))
        .filter(Boolean);
      const blockForParagraph =
        paragraphs.length === lessonBlocks.length
          ? paragraphs.map((_, i) => i)
          : alignParagraphsToBlocks(paragraphs, lessonBlocks);
      return paragraphs.flatMap((paragraph, i) => {
        const blockIndex = blockForParagraph[i] ?? 0;
        return splitForSpeech(paragraph).map((text) => ({ text, blockIndex }));
      });
    }
    return lessonBlocks.flatMap((block, blockIndex) => {
      const text = markdownToSpeech(block);
      return text ? splitForSpeech(text).map((t) => ({ text: t, blockIndex })) : [];
    });
  }, [module?.tts_script, lessonBlocks]);

  // The paragraph the player is on, for the article highlight.
  const currentBlock = speechChunks[chunkPos]?.blockIndex ?? 0;

  // Words spoken by the time each chunk STARTS, plus a final total. Drives the
  // player's elapsed/total readout at ~170 spoken words a minute.
  //
  // This is an estimate, not a real position: the Web Speech API exposes no
  // duration and no playback clock. The old "About N min" label was the same
  // estimate, so nothing here is newly approximate.
  const wordsBeforeChunk = useMemo(() => {
    const cumulative: number[] = [0];
    let total = 0;
    for (const chunk of speechChunks) {
      total += chunk.text.split(/\s+/).filter(Boolean).length;
      cumulative.push(total);
    }
    return cumulative;
  }, [speechChunks]);

  // Dividing by the rate is what makes the speed buttons legible: picking 2x
  // visibly halves the total.
  const secondsForWords = (words: number) => (words / 170) * 60 / rate;
  const elapsedSeconds = secondsForWords(wordsBeforeChunk[chunkPos] ?? 0);
  const totalSeconds = secondsForWords(wordsBeforeChunk[wordsBeforeChunk.length - 1] ?? 0);

  // Filled portion of the seek track. Guarded at one chunk, where the range
  // input's min and max are both 0 and the ratio would be NaN.
  const seekPercent =
    speechChunks.length > 1 ? (chunkPos / (speechChunks.length - 1)) * 100 : 0;

  // The key is kept in a ref so the stable speech callbacks can persist the
  // position without being recreated per module.
  const audioPosKeyRef = useRef(audioPosKey);
  audioPosKeyRef.current = audioPosKey;

  // Moves the playback position AND saves it (position 0 = "start", not stored).
  const updateChunkPos = useCallback((index: number) => {
    setChunkPos(index);
    const key = audioPosKeyRef.current;
    if (!key) return;
    if (index > 0) {
      localStorage.setItem(key, String(index));
    } else {
      localStorage.removeItem(key);
    }
  }, []);

  // Restore the saved playback position whenever the module's audio loads.
  useEffect(() => {
    if (speechChunks.length === 0) return;
    const saved = audioPosKey ? Number(localStorage.getItem(audioPosKey) ?? "0") : 0;
    const clamped =
      Number.isFinite(saved) && saved > 0 ? Math.min(saved, speechChunks.length - 1) : 0;
    setChunkPos(clamped);
  }, [audioPosKey, speechChunks.length]);

  const speakChunk = useCallback(() => {
    if (stoppedRef.current) return;
    const session = playSessionRef.current;
    const index = chunkIndexRef.current;
    const chunk = chunksRef.current[index];
    if (!chunk) {
      // Natural end of the narration: playback position resets to the top.
      setSpeech("idle");
      updateChunkPos(0);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(chunk.text);
    utterance.rate = rateRef.current;
    if (voiceRef.current) utterance.voice = voiceRef.current;
    utterance.onstart = () => {
      if (playSessionRef.current === session) updateChunkPos(index);
    };
    utterance.onend = () => {
      if (playSessionRef.current !== session || stoppedRef.current) return;
      chunkIndexRef.current += 1;
      speakChunk();
    };
    utterance.onerror = () => {
      // Cancels surface here as errors too; only a live session goes idle.
      if (playSessionRef.current === session && !stoppedRef.current) setSpeech("idle");
    };
    window.speechSynthesis.speak(utterance);
  }, [updateChunkPos]);

  const startSpeechFrom = useCallback(
    (fromChunk: number) => {
      if (!ttsSupported || speechChunks.length === 0) return;
      playSessionRef.current += 1;
      window.speechSynthesis.cancel();
      stoppedRef.current = false;
      chunksRef.current = speechChunks;
      chunkIndexRef.current = Math.min(Math.max(fromChunk, 0), speechChunks.length - 1);
      setSpeech("playing");
      speakChunk();
    },
    [ttsSupported, speechChunks, speakChunk],
  );

  // One button, podcast semantics. Pause is deliberately NOT
  // speechSynthesis.pause(): Chrome's pause is unreliable (the queue can keep
  // playing right through it). Pausing hard-cancels instead, and resume
  // replays from the start of the current chunk, which costs at most a
  // sentence or two of repetition.
  function togglePlayback() {
    if (speech === "playing") {
      playSessionRef.current += 1;
      stoppedRef.current = true;
      window.speechSynthesis.cancel();
      setSpeech("paused");
    } else {
      startSpeechFrom(chunkPos);
    }
  }

  const stopSpeech = useCallback(() => {
    playSessionRef.current += 1;
    stoppedRef.current = true;
    window.speechSynthesis.cancel();
    setSpeech("idle");
  }, []);

  function restartPlayback() {
    stopSpeech();
    updateChunkPos(0);
    startSpeechFrom(0);
  }

  // Same commit semantics as seekTo. Dragging the speed slider fires a change
  // per step, and restarting the utterance on every one of those would stutter
  // the narration badly, so only the release restarts it.
  function changeRate(newRate: number, commit: boolean) {
    const clamped = Math.min(RATE_MAX, Math.max(RATE_MIN, newRate));
    setRate(clamped);
    rateRef.current = clamped;
    try {
      localStorage.setItem(scopeKey("nosey_lm_rate"), String(clamped));
    } catch {
      // Private mode or a full quota. Losing the preference is not worth an error.
    }
    // Session-safe restart of the current chunk so the change is heard
    // immediately (a raw cancel + speak races stale onend callbacks).
    if (commit && speech === "playing") {
      startSpeechFrom(chunkIndexRef.current);
    }
  }

  function selectVoice(uri: string) {
    setVoiceURI(uri);
    voiceRef.current = voices.find((v) => v.voiceURI === uri) ?? null;
    const key = scopeKey("nosey_lm_voice");
    if (uri) {
      localStorage.setItem(key, uri);
    } else {
      localStorage.removeItem(key);
    }
    // Like a rate change: session-safe restart so the new voice is heard now.
    if (speech === "playing") {
      startSpeechFrom(chunkIndexRef.current);
    }
  }

  useEffect(() => {
    if (!speedOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (!speedRef.current?.contains(e.target as Node)) setSpeedOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSpeedOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [speedOpen]);

  // Hide the pill while the quiz is on screen so it never sits on top of the
  // questions. The bottom rootMargin gives it a head start, so the pill is
  // already gone by the time the first question would slide under it rather
  // than overlapping for a frame.
  //
  // Narration is NOT paused here: the pill hiding is a layout decision, not a
  // playback one. Scrolling back up brings it back exactly where it was.
  useEffect(() => {
    if (!quizNode || typeof IntersectionObserver === "undefined") {
      setQuizInView(false);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        setQuizInView(entry.isIntersecting);
        // A popover left open behind a hidden dock would reappear open when
        // the reader scrolls back up.
        if (entry.isIntersecting) setSpeedOpen(false);
      },
      { rootMargin: "0px 0px 60px 0px" },
    );
    observer.observe(quizNode);
    return () => observer.disconnect();
  }, [quizNode]);

  // Keep the paragraph being read in view while the narration plays.
  useEffect(() => {
    if (speech !== "playing") return;
    const el = document.getElementById(`lm-lesson-block-${currentBlock}`);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
  }, [currentBlock, speech]);

  // Seek by dragging the progress slider. While dragging (commit=false) only
  // the position marker moves; on release (commit=true) playback jumps there
  // if it was running. Paused/idle seeks just move where play will start.
  function seekTo(index: number, commit: boolean) {
    const clamped = Math.min(Math.max(index, 0), Math.max(0, speechChunks.length - 1));
    updateChunkPos(clamped);
    if (commit && speech === "playing") {
      startSpeechFrom(clamped);
    }
  }

  function previewVoice() {
    if (!ttsSupported) return;
    // Halt the lesson queue (session bump makes its callbacks inert), then
    // speak a one-off sample outside the queue.
    stopSpeech();
    const sample = new SpeechSynthesisUtterance(
      "This is how your lessons will sound. Binary search runs in O of log n time.",
    );
    sample.rate = rateRef.current;
    if (voiceRef.current) sample.voice = voiceRef.current;
    window.speechSynthesis.speak(sample);
  }

  // Stop reading when leaving the page OR switching to another module (the
  // component stays mounted when only the :moduleId param changes). The restore
  // effect above re-derives the new module's saved position.
  useEffect(() => {
    return () => {
      if (ttsSupported) {
        playSessionRef.current += 1;
        stoppedRef.current = true;
        window.speechSynthesis.cancel();
        setSpeech("idle");
      }
    };
  }, [ttsSupported, numericModuleId]);

  // ── Quiz draft: restore, then persist ─────────────────────────────────────
  // Restore runs once per module (and again if the quiz itself changes, e.g.
  // after a lesson edit regenerates it). A saved draft brings back the shuffle
  // along with the answers, so a mid-quiz refresh returns the page exactly as
  // it was left instead of scrambling the questions under the student.
  const quizQuestions = module?.quiz;
  useEffect(() => {
    if (numericModuleId == null || !quizQuestions?.length) {
      setQuizOrder(null);
      return;
    }
    const draft = readQuizDraft(numericModuleId, quizQuestions);
    if (draft) {
      setQuizOrder({ questionOrder: draft.questionOrder, optionOrders: draft.optionOrders });
      setAnswers(draft.answers);
    } else {
      setQuizOrder(makeQuizOrder(quizQuestions));
      setAnswers({});
    }
    setResult(null);
  }, [numericModuleId, quizQuestions]);

  // A graded quiz is not a draft, so persistence stops once `result` is set.
  // retryQuiz clears the key before clearing `result`, so the next write here
  // stores the fresh shuffle rather than resurrecting the old one.
  useEffect(() => {
    if (numericModuleId == null || !quizOrder || result) return;
    try {
      localStorage.setItem(
        quizDraftKey(numericModuleId),
        JSON.stringify({ ...quizOrder, answers } satisfies QuizDraft),
      );
    } catch {
      // Private mode or a full quota. A lost draft is not worth an error.
    }
  }, [numericModuleId, quizOrder, answers, result]);

  function clearQuizDraft() {
    if (numericModuleId == null) return;
    try {
      localStorage.removeItem(quizDraftKey(numericModuleId));
    } catch {
      /* nothing to clean up */
    }
  }

  async function handleSubmitQuiz() {
    if (!module?.quiz || submitting) return;
    const answerList = module.quiz.map((_, i) => answers[i] ?? -1);
    setSubmitting(true);
    setError(null);
    try {
      const graded = await submitModuleQuiz(module.id, answerList);
      setResult(graded);
      // The attempt is over, so the draft has served its purpose.
      clearQuizDraft();
      // Reflect the pass locally so "Next module" unlocks without a refetch.
      if (graded.passed && track && module) {
        // The WHOLE track is complete when this was the last module and every
        // other module was already passed. That moment gets confetti; passing a
        // single module or finishing the last article alone does not.
        const trackCompleted =
          !nextModule && track.modules.every((m) => m.id === module.id || m.passed);
        if (trackCompleted) fireConfetti();
        setTrack({
          ...track,
          modules: track.modules.map((m) =>
            m.id === module.id ? { ...m, passed: true, best_score: graded.best_score } : m,
          ),
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not grade the quiz. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // A retry must not be passable from memory of where the answers sat, so both
  // the question order and every question's option order are redrawn.
  function retryQuiz() {
    clearQuizDraft();
    setAnswers({});
    setResult(null);
    setError(null);
    if (module?.quiz?.length) setQuizOrder(makeQuizOrder(module.quiz));
  }

  async function handleSaveVideo(url: string | null) {
    if (!module || savingVideo) return;
    setSavingVideo(true);
    setVideoError(null);
    try {
      const updated = await updateModuleVideo(module.id, url);
      if (track) {
        setTrack({
          ...track,
          modules: track.modules.map((m) => (m.id === updated.id ? updated : m)),
        });
      }
      setVideoFormOpen(false);
    } catch (err) {
      setVideoError(err instanceof Error ? err.message : "Could not save the video link.");
    } finally {
      setSavingVideo(false);
    }
  }

  function startEditing() {
    if (!module?.lesson_content) return;
    stopSpeech();
    setDraft(module.lesson_content);
    setEditError(null);
    setEditing(true);
  }

  // Repairs the stored article's mangled escape sequences and drops the result
  // into the edit view rather than saving it. Nothing is written until you read
  // the diff and press Save, because this overwrites the article.
  //
  // Deterministic and local: no LLM call, so it cannot reword anything. See
  // repairLessonMarkdown.ts for what it does and does not touch.
  function startReformat() {
    if (!module?.lesson_content) return;
    stopSpeech();
    setDraft(repairLessonMarkdown(module.lesson_content));
    setEditError(null);
    setEditing(true);
  }

  async function handleSaveEdit() {
    if (!module || savingEdit) return;
    const lesson = draft.trim();
    if (!lesson) {
      setEditError("The lesson cannot be empty.");
      return;
    }
    setSavingEdit(true);
    setEditError(null);
    try {
      const updated = await updateModuleLesson(module.id, lesson);
      // Swap the fresh module (new lesson, narration script, and quiz) into
      // the track and clear any in-progress quiz state, which referred to the
      // old questions.
      if (track) {
        setTrack({
          ...track,
          modules: track.modules.map((m) => (m.id === updated.id ? updated : m)),
        });
      }
      setAnswers({});
      setResult(null);
      updateChunkPos(0);
      setEditing(false);
    } catch (err) {
      // On a 503 the edit itself was saved server-side (only the regen
      // failed), so the message from the backend explains what to do; keep
      // the editor open so the user does not lose context either way.
      setEditError(err instanceof Error ? err.message : "Could not save your edits. Try again.");
    } finally {
      setSavingEdit(false);
    }
  }

  if (numericFolderId == null || numericModuleId == null) return <Navigate to="/flashcards" replace />;
  if (!betaMode) return <Navigate to={`/flashcards/${numericFolderId}`} replace />;

  if (!loaded) {
    return (
      <div className="page page-narrow">
        <SkeletonText lines={7} label="Loading the lesson" />
      </div>
    );
  }

  if (!module || !module.lesson_content) {
    return (
      <div className="page page-narrow">
        <Card className="lm-failed">
          <div>
            <strong>This module is not ready yet.</strong>
            <p className="muted small">It may still be generating, or the track was rebuilt.</p>
          </div>
          <Link to={`/flashcards/${numericFolderId}/modules`}>
            <Button variant="secondary">Back to track</Button>
          </Link>
        </Card>
      </div>
    );
  }

  const quiz = module.quiz ?? [];
  const allAnswered = quiz.length > 0 && quiz.every((_, i) => answers[i] != null);

  // Display order. The questions are held back until this exists rather than
  // rendered in canonical order first: the restore effect runs after paint, so
  // a fallback would flash the unshuffled quiz and then visibly reorder it.
  const questionOrder = quizOrder?.questionOrder ?? [];
  const optionOrders = quizOrder?.optionOrders ?? [];

  // Jump target for an explanation's "Review" link: the lesson block whose
  // heading the LLM named. Built from the rendered blocks so the id it
  // produces always matches one on the page.
  const blockIndexByHeading = new Map<string, number>();
  lessonBlocks.forEach((block, index) => {
    const heading = block.split("\n").find((line) => /^#{1,6}\s/.test(line.trim()));
    if (heading) blockIndexByHeading.set(headingKey(heading), index);
  });

  function reviewSection(section: string) {
    const index = blockIndexByHeading.get(headingKey(section));
    if (index == null) return;
    const el = document.getElementById(`lm-lesson-block-${index}`);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  }

  // Gates both the dock itself and the bottom clearance the article needs for
  // it, so edit mode and browsers without speech synthesis do not reserve a
  // band of empty space for a pill that never renders.
  // Surfaces the reformat button in the header when the damage is visible.
  // The menu item is always there, so a false negative here still leaves a
  // way to run it.
  const articleMangled = !editing && looksMangled(module.lesson_content ?? "");

  const playerVisible = !editing && ttsSupported && speechChunks.length > 0;

  return (
    <div className={`page page-narrow lm-lesson-page ${playerVisible ? "is-docked" : ""}`}>
      <header className="page-header mode-header">
        <Link
          className="flash-back-btn"
          to={`/flashcards/${numericFolderId}/modules`}
          aria-label="Back to track"
          title="Back to track"
        >
          <ArrowLeft size={18} />
        </Link>
        <div className="lm-header-main">
          <span className="eyebrow">
            Module {moduleIndex + 1} of {track?.modules.length ?? "?"}
          </span>
          <h1>{module.title}</h1>
          {module.summary ? <p className="muted">{module.summary}</p> : null}
        </div>
        {!editing ? (
          <div className="flash-header-actions">
            <button
              className="flash-icon-btn"
              onClick={() => {
                setVideoDraft(module.video_url ?? "");
                setVideoError(null);
                setVideoFormOpen((open) => !open);
              }}
              type="button"
              aria-label={module.video_url ? "Edit video link" : "Add video link"}
              title={module.video_url ? "Edit video link" : "Add video link"}
              disabled={savingVideo}
            >
              <Video size={17} />
            </button>
            {/* Always present, never gated on the damage detector. The repair
                is idempotent, so running it on a clean article is a no-op, and
                a detector with one false negative would hide the fix at exactly
                the moment it is needed. `articleMangled` only changes how loud
                the button is. */}
            <button
              className={`flash-icon-btn lm-reformat-btn ${articleMangled ? "is-needed" : ""}`}
              onClick={startReformat}
              type="button"
              aria-label="Reformat article"
              title={
                articleMangled
                  ? "This article's formatting looks broken. Reformat it."
                  : "Reformat article"
              }
            >
              <RotateCcw size={17} />
            </button>
            <div className="lm-menu-wrap">
              <button
                className="flash-icon-btn"
                onClick={() => setMenuOpen((open) => !open)}
                type="button"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label="Lesson options"
                title="Lesson options"
                disabled={savingEdit}
              >
                <Pencil size={17} />
              </button>
              {menuOpen ? (
                <div className="lm-header-menu" role="menu">
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      setVoiceFormOpen(false);
                      startEditing();
                    }}
                  >
                    <Pencil size={15} /> Edit article
                  </button>
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      setVoiceFormOpen(false);
                      startReformat();
                    }}
                  >
                    <RotateCcw size={15} /> Reformat article
                  </button>
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      setVoiceFormOpen((open) => !open);
                    }}
                  >
                    <Volume2 size={15} /> Change voice
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </header>

      {!editing && voiceFormOpen ? (
        <Card className="lm-voice-form">
          <label className="lm-setup-label" htmlFor="lm-voice-select">
            Narration voice
          </label>
          <p className="muted small">
            Voices come from your browser: Chrome includes Google voices, other browsers offer
            their own. Your pick applies to every lesson on this device.
          </p>
          <select
            id="lm-voice-select"
            className="lm-voice-select"
            value={voiceURI}
            onChange={(e) => selectVoice(e.target.value)}
          >
            <option value="">Browser default</option>
            {voiceOptions.map((voice) => (
              <option key={voice.voiceURI} value={voice.voiceURI}>
                {voice.name} ({voice.lang})
              </option>
            ))}
          </select>
          <div className="button-row">
            <Button variant="secondary" onClick={previewVoice}>
              Preview voice
            </Button>
            <Button variant="secondary" onClick={() => setVoiceFormOpen(false)}>
              Done
            </Button>
          </div>
        </Card>
      ) : null}

      {playerVisible ? (
        /* Fixed dock, never inline: the whole point is that Play/Pause stays
           reachable from the bottom of a 1000-word article. Structured like
           MobileDock (a full-width positioner that ignores pointer events, a
           centred rail that takes them) so the page stays clickable either
           side of the pill on a wide screen. */
        <div className="lm-audio-player" data-hidden={quizInView}>
          <div className="lm-dock-rail" role="group" aria-label="Listen to this lesson">
            <button
              className="lm-dock-toggle"
              type="button"
              onClick={togglePlayback}
              aria-label={speech === "playing" ? "Pause narration" : "Play narration"}
            >
              {speech === "playing" ? <Pause size={20} /> : <Play size={20} />}
            </button>
            <input
              className="lm-dock-seek"
              type="range"
              min={0}
              max={Math.max(0, speechChunks.length - 1)}
              value={chunkPos}
              aria-label="Seek position in the narration"
              // WebKit has no ::-moz-range-progress equivalent, so the filled
              // portion is painted as a hard-stop gradient on the track at
              // this percentage. Firefox uses the real pseudo-element and
              // ignores it.
              style={{ "--seek-pct": `${seekPercent}%` } as CSSProperties}
              onChange={(e) => seekTo(Number(e.target.value), false)}
              onPointerUp={(e) => seekTo(Number((e.target as HTMLInputElement).value), true)}
              onKeyUp={(e) => seekTo(Number((e.target as HTMLInputElement).value), true)}
            />
            <span className="lm-dock-clock">
              {formatClock(elapsedSeconds)} / {formatClock(totalSeconds)}
            </span>
            {!isMobileShell && chunkPos > 0 ? (
              <button
                className="lm-dock-restart"
                type="button"
                onClick={restartPlayback}
                aria-label="Start over from the beginning"
                title="Start over"
              >
                <RotateCcw size={15} />
              </button>
            ) : null}
            {/* One speed control at every width: a chip that opens a slider.
                Presets could not offer 1.7x, and five inline buttons never fit
                a one-row dock on a phone anyway. */}
            <div className="lm-dock-speed" ref={speedRef}>
              <button
                className={`lm-dock-rate-chip ${speedOpen ? "is-open" : ""}`}
                type="button"
                onClick={() => setSpeedOpen((open) => !open)}
                aria-expanded={speedOpen}
                aria-haspopup="dialog"
                aria-label={`Playback speed: ${formatRate(rate)}. Open speed control.`}
              >
                {formatRate(rate)}
              </button>
              {speedOpen ? (
                <div className="lm-dock-speed-pop" role="dialog" aria-label="Playback speed">
                  <div className="lm-dock-speed-head">
                    <span>Speed</span>
                    {/* Back to normal is by far the most common adjustment, and
                        hitting exactly 1.00 by dragging is fiddly. */}
                    <button
                      className="lm-dock-speed-reset"
                      type="button"
                      onClick={() => changeRate(1, true)}
                      disabled={rate === 1}
                    >
                      Reset
                    </button>
                  </div>
                  <input
                    className="lm-dock-speed-range"
                    type="range"
                    min={RATE_MIN}
                    max={RATE_MAX}
                    step={RATE_STEP}
                    value={rate}
                    autoFocus
                    aria-label="Playback speed"
                    aria-valuetext={formatRate(rate)}
                    style={{ "--seek-pct": `${((rate - RATE_MIN) / (RATE_MAX - RATE_MIN)) * 100}%` } as CSSProperties}
                    onChange={(e) => changeRate(Number(e.target.value), false)}
                    onPointerUp={(e) => changeRate(Number((e.target as HTMLInputElement).value), true)}
                    onKeyUp={(e) => changeRate(Number((e.target as HTMLInputElement).value), true)}
                  />
                  <div className="lm-dock-speed-scale">
                    <span>{formatRate(RATE_MIN)}</span>
                    <strong>{formatRate(rate)}</strong>
                    <span>{formatRate(RATE_MAX)}</span>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {!editing && videoFormOpen ? (
        <Card className="lm-video-form">
          <label className="lm-setup-label" htmlFor="lm-video-url">
            Video link
          </label>
          <p className="muted small">
            Paste a YouTube, Vimeo, or direct video link. It plays at the bottom of this article.
          </p>
          <input
            id="lm-video-url"
            className="lm-instructions-input lm-video-input"
            type="url"
            placeholder="https://www.youtube.com/watch?v=..."
            value={videoDraft}
            onChange={(e) => setVideoDraft(e.target.value)}
            disabled={savingVideo}
          />
          <FormError message={videoError} />
          <div className="button-row">
            <Button
              onClick={() => void handleSaveVideo(videoDraft.trim() || null)}
              disabled={savingVideo || !videoDraft.trim()}
            >
              {savingVideo ? <InlineLoading label="Saving" /> : "Save link"}
            </Button>
            {module.video_url ? (
              <Button variant="secondary" onClick={() => void handleSaveVideo(null)} disabled={savingVideo}>
                Remove video
              </Button>
            ) : null}
            <Button variant="secondary" onClick={() => setVideoFormOpen(false)} disabled={savingVideo}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}

      {editing ? (
        <Card className="lm-lesson-card lm-edit-card">
          <label className="lm-setup-label" htmlFor="lm-edit-area">
            Edit article
          </label>
          <p className="muted small">
            Plain markdown. When you save, the audio script and quiz are rebuilt to match your
            version, which can take a minute.
          </p>
          <textarea
            id="lm-edit-area"
            className="lm-instructions-input lm-edit-area"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={savingEdit}
          />
          <FormError message={editError} />
          {savingEdit ? (
            <LoadingNotice
              compact
              title="Rebuilding the audio script and quiz"
              estimate="Your edits are already saved. This usually takes under a minute."
              slowNote="Still working. Long articles take longer to narrate and quiz."
              slowAfterMs={45000}
            />
          ) : null}
          <div className="button-row">
            {/* Plain text, no second spinner: the LoadingNotice above already
                owns the spinner and the explanation. A spinner here as well
                read as two unrelated loaders, and because the button is
                disabled while saving its faded style left the ring looking
                like it was floating on its own next to Cancel. */}
            <Button onClick={() => void handleSaveEdit()} disabled={savingEdit || !draft.trim()}>
              {savingEdit ? "Saving…" : "Save article"}
            </Button>
            <Button variant="secondary" onClick={() => setEditing(false)} disabled={savingEdit}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}

      {editing ? null : (
      <Card className="lm-lesson-card">
        {lessonBlocks.map((block, index) => {
          // Paragraph-level "now reading" marker driven by the player. The
          // narration is a spoken rewrite, so the highlight shows which
          // paragraph is being covered, not a word-for-word position.
          const isCurrent = index === currentBlock;
          const stateClass = isCurrent
            ? speech === "playing"
              ? "is-speaking"
              : speech === "paused" || chunkPos > 0
                ? "is-cursor"
                : ""
            : "";
          return (
            <div key={index} id={`lm-lesson-block-${index}`} className={`lm-lesson-block ${stateClass}`}>
              <MarkdownContent content={block} />
            </div>
          );
        })}
      </Card>
      )}

      {!editing && module.video_url ? (
        (() => {
          const embed = toVideoEmbed(module.video_url);
          let host = module.video_url;
          try {
            host = new URL(module.video_url).hostname.replace(/^www\./, "");
          } catch {
            /* keep the raw url */
          }
          return (
            <Card className="lm-video-card">
              <div className="lm-video-head">
                <span className="eyebrow">Video resource</span>
                <a
                  className="lm-video-source small"
                  href={module.video_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open on {host}
                </a>
              </div>
              {embed.kind === "iframe" ? (
                <div className="lm-video-frame">
                  <iframe
                    src={embed.src}
                    title="Video resource"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              ) : embed.kind === "video" ? (
                <video className="lm-video-player" src={embed.src} controls />
              ) : (
                <p className="muted small lm-video-fallback">
                  This link can't be embedded here. Use "Open on {host}" above to watch it.
                </p>
              )}
            </Card>
          );
        })()
      ) : null}

      {editing ? null : (
      <section className="lm-quiz" ref={setQuizNode}>
        <h2 className="lm-quiz-title">Check your understanding</h2>
        <p className="muted small">
          {quiz.length} questions. Score {Math.ceil(quiz.length * 0.8)} or better to unlock the next
          module.
        </p>

        {/* Rendering walks the shuffled order. `qIndex` is always the CANONICAL
            question index and `oIndex` the canonical option index, because
            answers, correct_indices and option_explanations are all canonical;
            only `displayPos` reflects where something sits on screen. */}
        {questionOrder.map((qIndex, questionPos) => {
          const question = quiz[qIndex];
          if (!question) return null;
          const chosen = answers[qIndex];
          const correctIndex = result?.correct_indices[qIndex];
          const explanation = result?.explanations?.[qIndex];
          const optionOrder = optionOrders[qIndex] ?? question.options.map((_, i) => i);
          // The letter a given canonical option was shown as, so the
          // explanation below names the same letters the student just read.
          const letterFor = (oIndex: number) =>
            String.fromCharCode(65 + Math.max(0, optionOrder.indexOf(oIndex)));
          const wasWrong = result != null && correctIndex != null && chosen !== correctIndex;
          return (
            <Card key={qIndex} className="lm-quiz-question">
              <div className="lm-quiz-q-text">
                <span className="lm-quiz-q-num">{questionPos + 1}.</span>
                <div className="lm-quiz-q-md">
                  <MarkdownContent content={question.question} />
                </div>
              </div>
              <div className="lm-quiz-options">
                {optionOrder.map((oIndex, displayPos) => {
                  const option = question.options[oIndex];
                  if (option == null) return null;
                  let stateClass = "";
                  if (result) {
                    if (oIndex === correctIndex) stateClass = "is-correct";
                    else if (oIndex === chosen) stateClass = "is-wrong";
                  } else if (oIndex === chosen) {
                    stateClass = "is-chosen";
                  }
                  return (
                    <button
                      key={oIndex}
                      type="button"
                      className={`lm-quiz-option ${stateClass}`}
                      disabled={result != null}
                      onClick={() => setAnswers((prev) => ({ ...prev, [qIndex]: oIndex }))}
                    >
                      <span className="lm-quiz-option-letter">{String.fromCharCode(65 + displayPos)}</span>
                      <span className="lm-quiz-option-text">
                        <MarkdownContent content={option} />
                      </span>
                      {result && oIndex === correctIndex ? <CheckCircle2 size={16} /> : null}
                      {result && oIndex === chosen && oIndex !== correctIndex ? <XCircle size={16} /> : null}
                    </button>
                  );
                })}
              </div>
              {/* Only on a miss. A correct answer needs no lecture, and the
                  green highlight already says everything. */}
              {wasWrong && explanation?.explanation ? (
                <div className="lm-quiz-explain">
                  <MarkdownContent content={explanation.explanation} />
                  {explanation.option_explanations.length === question.options.length ? (
                    <div className="lm-quiz-explain-options">
                      <div className="lm-quiz-explain-row is-correct">
                        <span className="lm-quiz-explain-label">Correct: {letterFor(correctIndex)}</span>
                        <MarkdownContent content={explanation.option_explanations[correctIndex]} />
                      </div>
                      {chosen != null ? (
                        <div className="lm-quiz-explain-row is-wrong">
                          <span className="lm-quiz-explain-label">You chose: {letterFor(chosen)}</span>
                          <MarkdownContent content={explanation.option_explanations[chosen]} />
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {explanation.lesson_section &&
                  blockIndexByHeading.has(headingKey(explanation.lesson_section)) ? (
                    <button
                      type="button"
                      className="lm-quiz-explain-review"
                      onClick={() => reviewSection(explanation.lesson_section)}
                    >
                      <ArrowLeft size={14} />
                      Review: {explanation.lesson_section.replace(/^#+\s*/, "")}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </Card>
          );
        })}

        <FormError message={error} />

        {result == null ? (
          <div className="button-row">
            <Button onClick={() => void handleSubmitQuiz()} disabled={!allAnswered || submitting}>
              {submitting ? "Grading…" : "Submit answers"}
            </Button>
          </div>
        ) : (
          <Card className={`lm-quiz-result ${result.passed ? "is-pass" : "is-fail"}`}>
            {result.passed ? <CheckCircle2 size={30} /> : <XCircle size={30} />}
            <div className="lm-quiz-result-body">
              <strong>
                {result.score} / {result.total} {result.passed ? "- module passed" : "- not quite"}
              </strong>
              <p className="muted small">
                {result.passed
                  ? nextModule
                    ? "The next module is unlocked."
                    : "That was the last module in the track."
                  : "Reread the lesson and try the quiz again."}
              </p>
            </div>
            <div className="button-row">
              {!result.passed ? (
                <Button variant="secondary" icon={<RotateCcw size={16} />} onClick={retryQuiz}>
                  Retry quiz
                </Button>
              ) : null}
              {result.passed && nextModule ? (
                nextModule.ready ? (
                  <Link to={`/flashcards/${numericFolderId}/modules/${nextModule.id}`} onClick={retryQuiz}>
                    <Button icon={<ArrowRight size={16} />}>Next module</Button>
                  </Link>
                ) : (
                  <Button disabled>Next module is generating…</Button>
                )
              ) : null}
              {result.passed && !nextModule ? (
                <Link to={`/flashcards/${numericFolderId}/modules`}>
                  <Button>Back to track</Button>
                </Link>
              ) : null}
            </div>
          </Card>
        )}
      </section>
      )}
      {confettiElement}
    </div>
  );
}
