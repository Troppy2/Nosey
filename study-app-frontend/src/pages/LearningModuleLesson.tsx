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
import { Link, Navigate, useParams } from "react-router-dom";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { InlineLoading, LoadingNotice } from "../components/Loaders";
import { MarkdownContent } from "../components/MarkdownContent";
import { SkeletonText } from "../components/Skeletons";
import {
  fetchLearningTrack,
  scopeKey,
  submitModuleQuiz,
  updateModuleLesson,
  updateModuleVideo,
} from "../lib/api";
import { useSettings } from "../lib/useSettings";
import type { LearningTrack, QuizAttemptResult } from "../lib/types";

// Converts notation TTS engines mangle or skip into the words a teacher would
// say aloud: Big-O, exponents, subscripts, comparison operators, indexing, and
// function calls. Runs on every speech block as a safety net; the LLM-written
// narration script should already be plain prose, but raw notation must never
// reach the voice as symbols it silently drops.
function notationToSpeech(text: string): string {
  let out = text;
  // Complexity classes first, before the generic call rule: O(n log n) -> "O of n log n".
  // (?<!\w) instead of \b because \b never matches before the non-ASCII Θ/Ω.
  out = out.replace(/(?<!\w)(O|Θ|Theta|Ω|Omega)\(([^()]*)\)/g, (_m, fn: string, inner: string) => {
    const name = fn === "Θ" ? "big theta" : fn === "Ω" ? "big omega" : fn === "O" ? "O" : fn;
    return `${name} of ${inner}`;
  });
  // Common LaTeX commands that survive stripping.
  out = out.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, " $1 over $2 ");
  out = out.replace(/\\sqrt\{?\(?([\w+\-^ ]+)\)?\}?/g, " the square root of $1 ");
  out = out.replace(/\\sum\b/g, " the sum of ");
  out = out.replace(/\\int\b/g, " the integral of ");
  out = out.replace(/\\infty\b/g, " infinity ");
  out = out.replace(/\\pi\b/g, " pi ");
  out = out.replace(/\\cdot\b|\\times\b|×|·/g, " times ");
  out = out.replace(/\\le(q)?\b/g, " less than or equal to ");
  out = out.replace(/\\ge(q)?\b/g, " greater than or equal to ");
  out = out.replace(/\\ne(q)?\b/g, " not equal to ");
  // Unknown LaTeX commands read as gibberish; drop the backslash word, keep args.
  out = out.replace(/\\[a-zA-Z]+/g, " ");
  // Exponents and subscripts: n^2 "n squared", x^k "x to the power of k", a_i "a sub i".
  out = out.replace(/(\w)\^\{?2\}?(?!\w)/g, "$1 squared");
  out = out.replace(/(\w)\^\{?3\}?(?!\w)/g, "$1 cubed");
  out = out.replace(/(\w)\^\{?([\w+\-]+)\}?/g, "$1 to the power of $2");
  out = out.replace(/\b(\w)_\{?(\w+)\}?/g, "$1 sub $2");
  // Operators the voice skips or misreads.
  out = out.replace(/<=/g, " less than or equal to ");
  out = out.replace(/>=/g, " greater than or equal to ");
  out = out.replace(/!==?/g, " not equal to ");
  out = out.replace(/===?/g, " equals ");
  out = out.replace(/(\s)=(\s)/g, "$1equals$2");
  out = out.replace(/(\s)\+(\s)/g, "$1plus$2");
  out = out.replace(/(\s)\*(\s)/g, "$1times$2");
  out = out.replace(/->|→/g, " to ");
  out = out.replace(/\bn!/g, "n factorial");
  // Code shapes: arr[i] "arr at index i", foo() "the foo function", f(x) "f of x".
  out = out.replace(/\b(\w+)\[(\w+)\]/g, "$1 at index $2");
  out = out.replace(/\b([a-zA-Z_]\w*)\(\)/g, "the $1 function");
  out = out.replace(/\b([a-zA-Z_]\w*)\(([^()]*)\)/g, "$1 of $2");
  // Leftover braces from LaTeX arguments.
  out = out.replace(/[{}]/g, " ");
  return out;
}

// Converts a markdown lesson into plain sentences the Web Speech API can read
// without announcing syntax. Fenced code blocks are summarized (reading code
// line by line aloud is worse than useless); everything else, including inline
// math and code spans, is unwrapped and passed through notationToSpeech so the
// voice reads "O of n" instead of skipping "O(n)".
function markdownToSpeech(markdown: string): string {
  let text = markdown;
  text = text.replace(/```[\s\S]*?```/g, " Here, see the code example on screen. ");
  // Unwrap math instead of hiding it; notationToSpeech makes it speakable.
  text = text.replace(/\$\$([\s\S]*?)\$\$/g, " $1 ");
  text = text.replace(/\$([^$\n]+)\$/g, " $1 ");
  text = text.replace(/^#{1,6}\s*/gm, "");
  text = text.replace(/\*\*([^*]+)\*\*/g, "$1");
  text = text.replace(/\*([^*]+)\*/g, "$1");
  text = text.replace(/`([^`]+)`/g, "$1");
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  text = text.replace(/^[-*+]\s+/gm, "");
  text = text.replace(/^\d+\.\s+/gm, "");
  text = text.replace(/\|/g, " ");
  text = notationToSpeech(text);
  return text.replace(/\s+/g, " ").trim();
}

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

// Chrome silently stops long utterances, so the lesson is split into short
// chunks that are queued one after another.
function splitForSpeech(text: string, maxLen = 220): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [text];
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if ((current + sentence).length > maxLen && current) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current += sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
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

export default function LearningModuleLesson() {
  const { folderId, moduleId } = useParams();
  const numericFolderId = folderId ? Number(folderId) : null;
  const numericModuleId = moduleId ? Number(moduleId) : null;
  const { betaMode } = useSettings();

  const [track, setTrack] = useState<LearningTrack | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [result, setResult] = useState<QuizAttemptResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  const [rate, setRate] = useState(1);
  // Position in the chunk queue: drives the progress bar and, persisted to
  // localStorage per module, lets the listener resume where they left off.
  const [chunkPos, setChunkPos] = useState(0);
  const chunkIndexRef = useRef(0);
  const chunksRef = useRef<{ text: string; blockIndex: number }[]>([]);
  const stoppedRef = useRef(false);
  const rateRef = useRef(1);
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
    if (numericFolderId == null) return;
    fetchLearningTrack(numericFolderId)
      .then(setTrack)
      .catch(() => setTrack(null))
      .finally(() => setLoaded(true));
  }, [numericFolderId]);

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
      const lastBlock = Math.max(0, lessonBlocks.length - 1);
      return paragraphs.flatMap((paragraph, i) => {
        const blockIndex =
          paragraphs.length === lessonBlocks.length
            ? i
            : Math.min(lastBlock, Math.round((i * lastBlock) / Math.max(1, paragraphs.length - 1)));
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

  // Rough listen time at 1x for the player label (~170 spoken words a minute).
  const estMinutes = useMemo(() => {
    const words = speechChunks
      .map((c) => c.text)
      .join(" ")
      .split(/\s+/)
      .filter(Boolean).length;
    return Math.max(1, Math.round(words / 170));
  }, [speechChunks]);

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

  function changeRate(newRate: number) {
    setRate(newRate);
    rateRef.current = newRate;
    // Session-safe restart of the current chunk so the change is heard
    // immediately (a raw cancel + speak races stale onend callbacks).
    if (speech === "playing") {
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

  async function handleSubmitQuiz() {
    if (!module?.quiz || submitting) return;
    const answerList = module.quiz.map((_, i) => answers[i] ?? -1);
    setSubmitting(true);
    setError(null);
    try {
      const graded = await submitModuleQuiz(module.id, answerList);
      setResult(graded);
      // Reflect the pass locally so "Next module" unlocks without a refetch.
      if (graded.passed && track && module) {
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

  function retryQuiz() {
    setAnswers({});
    setResult(null);
    setError(null);
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

  return (
    <div className="page page-narrow lm-lesson-page">
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

      {!editing && ttsSupported && speechChunks.length > 0 ? (
        <div className="lm-audio-player" role="group" aria-label="Listen to this lesson">
          <button
            className="lm-audio-toggle"
            type="button"
            onClick={togglePlayback}
            aria-label={speech === "playing" ? "Pause narration" : "Play narration"}
          >
            {speech === "playing" ? <Pause size={20} /> : <Play size={20} />}
          </button>
          <div className="lm-audio-body">
            <div className="lm-audio-titles">
              <strong>Listen to this lesson</strong>
              <span className="muted small">
                {speech === "playing"
                  ? "Playing"
                  : speech === "paused"
                    ? "Paused"
                    : chunkPos > 0
                      ? "Resume where you left off"
                      : `About ${estMinutes} min`}
              </span>
            </div>
            <input
              className="lm-audio-seek"
              type="range"
              min={0}
              max={Math.max(0, speechChunks.length - 1)}
              value={chunkPos}
              aria-label="Seek position in the narration"
              onChange={(e) => seekTo(Number(e.target.value), false)}
              onPointerUp={(e) => seekTo(Number((e.target as HTMLInputElement).value), true)}
              onKeyUp={(e) => seekTo(Number((e.target as HTMLInputElement).value), true)}
            />
          </div>
          {chunkPos > 0 ? (
            <button
              className="lm-audio-restart"
              type="button"
              onClick={restartPlayback}
              aria-label="Start over from the beginning"
              title="Start over"
            >
              <RotateCcw size={15} />
            </button>
          ) : null}
          <div className="lm-audio-rates" aria-label="Playback speed">
            {[0.75, 1, 1.25, 1.5, 2].map((option) => (
              <button
                key={option}
                type="button"
                className={`lm-audio-rate ${rate === option ? "is-active" : ""}`}
                onClick={() => changeRate(option)}
              >
                {option}x
              </button>
            ))}
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
          {videoError ? <div className="form-error">{videoError}</div> : null}
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
          {editError ? <div className="form-error">{editError}</div> : null}
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
            <Button onClick={() => void handleSaveEdit()} disabled={savingEdit || !draft.trim()}>
              {savingEdit ? <InlineLoading label="Saving" /> : "Save article"}
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
      <section className="lm-quiz">
        <h2 className="lm-quiz-title">Check your understanding</h2>
        <p className="muted small">
          {quiz.length} questions. Score {Math.ceil(quiz.length * 0.8)} or better to unlock the next
          module.
        </p>

        {quiz.map((question, qIndex) => {
          const chosen = answers[qIndex];
          const correctIndex = result?.correct_indices[qIndex];
          return (
            <Card key={qIndex} className="lm-quiz-question">
              <div className="lm-quiz-q-text">
                <span className="lm-quiz-q-num">{qIndex + 1}.</span>
                <div className="lm-quiz-q-md">
                  <MarkdownContent content={question.question} />
                </div>
              </div>
              <div className="lm-quiz-options">
                {question.options.map((option, oIndex) => {
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
                      <span className="lm-quiz-option-letter">{String.fromCharCode(65 + oIndex)}</span>
                      <span className="lm-quiz-option-text">
                        <MarkdownContent content={option} />
                      </span>
                      {result && oIndex === correctIndex ? <CheckCircle2 size={16} /> : null}
                      {result && oIndex === chosen && oIndex !== correctIndex ? <XCircle size={16} /> : null}
                    </button>
                  );
                })}
              </div>
            </Card>
          );
        })}

        {error ? <div className="form-error">{error}</div> : null}

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
    </div>
  );
}
