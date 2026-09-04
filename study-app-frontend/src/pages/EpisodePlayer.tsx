import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Music2,
  Pause,
  Play,
  Presentation,
  RotateCcw,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { Button } from "../components/Button";
import { FormError } from "../components/FormError";
import { Card } from "../components/Card";
import { useConfetti } from "../components/Confetti";
import { SkeletonText } from "../components/Skeletons";
import {
  castFor,
  CastVoices,
  notationToSpeech,
  speechCapability,
  splitForSpeech,
} from "../components/episodeSpeech";
import { answerCheckpoint, fetchModuleEpisode, fetchTrackForModule, scopeKey } from "../lib/api";
import type { CheckpointAnswerResult, EpisodeCheckpoint, ModuleEpisode } from "../lib/types";

type SpeechState = "idle" | "playing" | "paused";

const SPEAKER_LABELS: Record<string, string> = {
  host: "Host",
  expert: "Expert",
  lecturer: "Lecturer",
};

// One shared playback core for both episode formats, copied from the article
// lesson player: flat chunk queue, session-bumped callbacks (Chrome fires
// onend/onerror for cancelled utterances), hard-cancel pause, per-utterance
// voice settings. Each chunk knows its turn and speaker, the voice comes from
// the cast for that speaker, and the rate multiplies the user rate by the
// cast rate.
function useEpisodeSpeech(
  episode: ModuleEpisode | null,
  cast: CastVoices,
  userRate: number,
  onQueueEnd: () => void,
) {
  const ttsSupported = typeof window !== "undefined" && "speechSynthesis" in window;
  const [speech, setSpeech] = useState<SpeechState>("idle");
  const [chunkPos, setChunkPos] = useState(0);
  const chunkIndexRef = useRef(0);
  const chunksRef = useRef<{ text: string; turnIndex: number; speaker: string }[]>([]);
  const stoppedRef = useRef(false);
  const userRateRef = useRef(1);
  const castRef = useRef<CastVoices>({});
  const onQueueEndRef = useRef(onQueueEnd);
  onQueueEndRef.current = onQueueEnd;
  // Every (re)start bumps the session; callbacks from older sessions no-op,
  // because Chrome keeps firing onend/onerror for cancelled utterances.
  const playSessionRef = useRef(0);

  const chunks = useMemo<{ text: string; turnIndex: number; speaker: string }[]>(() => {
    if (!episode) return [];
    const out: { text: string; turnIndex: number; speaker: string }[] = [];
    episode.turns.forEach((turn, i) => {
      for (const chunkText of splitForSpeech(notationToSpeech(turn.text))) {
        out.push({ text: chunkText, turnIndex: i, speaker: turn.speaker });
      }
    });
    return out;
  }, [episode]);

  useEffect(() => {
    chunksRef.current = chunks;
    if (chunks.length === 0) return;
    // Restore the saved position for this module once the queue exists.
    const saved = Number(localStorage.getItem(scopeKey(`nosey_lm_episode_${episode!.module_id}`)) ?? "0");
    const clamped = Number.isFinite(saved) && saved > 0 ? Math.min(saved, chunks.length - 1) : 0;
    setChunkPos(clamped);
    chunkIndexRef.current = clamped;
  }, [chunks, episode]);

  useEffect(() => {
    userRateRef.current = userRate;
    castRef.current = cast;
  }, [userRate, cast]);

  const speakChunk = useCallback(() => {
    if (stoppedRef.current) return;
    const session = playSessionRef.current;
    const index = chunkIndexRef.current;
    const chunk = chunksRef.current[index];
    if (!chunk) {
      // Natural end of the episode: stop, reset the position, show the summary.
      setSpeech("idle");
      setChunkPos(0);
      chunkIndexRef.current = 0;
      onQueueEndRef.current();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(chunk.text);
    const cfg = castRef.current[chunk.speaker] ?? { voice: null, pitch: 1, rate: 1 };
    utterance.rate = userRateRef.current * (cfg.rate ?? 1);
    utterance.pitch = cfg.pitch ?? 1;
    if (cfg.voice) utterance.voice = cfg.voice;
    utterance.onstart = () => {
      if (playSessionRef.current === session) setChunkPos(index);
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
  }, []);

  const startSpeechFrom = useCallback(
    (fromChunk: number) => {
      if (!ttsSupported || chunksRef.current.length === 0) return;
      playSessionRef.current += 1;
      window.speechSynthesis.cancel();
      stoppedRef.current = false;
      chunkIndexRef.current = Math.min(Math.max(fromChunk, 0), chunksRef.current.length - 1);
      setSpeech("playing");
      speakChunk();
    },
    [ttsSupported, speakChunk],
  );

  // Pause is deliberately NOT speechSynthesis.pause(): Chrome's pause is
  // unreliable (the queue can keep playing right through it). Pausing
  // hard-cancels instead, and resume replays from the start of the current
  // chunk, which costs at most a sentence or two of repetition.
  const pause = useCallback(() => {
    playSessionRef.current += 1;
    stoppedRef.current = true;
    if (ttsSupported) window.speechSynthesis.cancel();
    setSpeech("paused");
  }, [ttsSupported]);

  const play = useCallback(() => startSpeechFrom(chunkIndexRef.current), [startSpeechFrom]);

  const seekTo = useCallback(
    (index: number, commit: boolean) => {
      const clamped = Math.min(Math.max(index, 0), Math.max(0, chunks.length - 1));
      setChunkPos(clamped);
      chunkIndexRef.current = clamped;
      if (commit && speech === "playing") startSpeechFrom(clamped);
    },
    [chunks.length, speech, startSpeechFrom],
  );

  const restart = useCallback(() => {
    playSessionRef.current += 1;
    stoppedRef.current = true;
    if (ttsSupported) window.speechSynthesis.cancel();
    setSpeech("idle");
    setChunkPos(0);
    chunkIndexRef.current = 0;
    startSpeechFrom(0);
  }, [ttsSupported, startSpeechFrom]);

  // Changing the rate mid-playback rebuilds the current utterance at once; the
  // new rate is committed to the ref synchronously so speakChunk uses it.
  const changeRate = useCallback(
    (newRate: number) => {
      userRateRef.current = newRate;
      if (speech === "playing") startSpeechFrom(chunkIndexRef.current);
    },
    [speech, startSpeechFrom],
  );

  // Stop speech when leaving the page or switching module (the route component
  // stays mounted when only :moduleId changes).
  useEffect(() => {
    return () => {
      if (ttsSupported) {
        playSessionRef.current += 1;
        stoppedRef.current = true;
        window.speechSynthesis.cancel();
        setSpeech("idle");
      }
    };
  }, [ttsSupported]);

  const currentTurn = chunks[chunkPos]?.turnIndex ?? 0;
  const currentSpeaker = chunks[chunkPos]?.speaker ?? episode?.turns[0]?.speaker ?? "lecturer";

  return {
    chunks,
    speech,
    chunkPos,
    currentTurn,
    currentSpeaker,
    updateChunkPos: (index: number) => {
      setChunkPos(index);
      chunkIndexRef.current = index;
    },
    startSpeechFrom,
    pause,
    play,
    seekTo,
    restart,
    changeRate,
    ttsSupported,
  };
}

function EpisodePlayerInner({
  episode,
  folderId,
  onModulePassed,
}: {
  episode: ModuleEpisode;
  folderId: number;
  onModulePassed?: () => void;
}) {
  // ── Voices ───────────────────────────────────────────────────────────────
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const voicesReadyRef = useRef(false);

  // getVoices() is async-populated: it returns an empty array on first call in
  // most browsers. The cast is computed from the voiceschanged-filled state so
  // the first episode of a session gets the accent split, not the default
  // system voice.
  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const load = () => {
      const list = window.speechSynthesis.getVoices();
      voicesReadyRef.current = list.length > 0;
      setVoices(list);
    };
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);

  const cast = useMemo<CastVoices>(() => castFor(episode.format, voices), [episode.format, voices]);

  // Capability is checked at mount, then re-checked once voices land (an empty
  // getVoices() on first call is inconclusive).
  const [speechUsable, setSpeechUsable] = useState<boolean>(speechCapability().usable);
  useEffect(() => {
    if (!speechUsable || !voicesReadyRef.current) return;
    setSpeechUsable(window.speechSynthesis.getVoices().length > 0);
  }, [voices.length, speechUsable]);

  // ── Player rate ──────────────────────────────────────────────────────────
  const [userRate, setUserRate] = useState(1);

  // ── Checkpoint + summary state ────────────────────────────────────────────
  // Local grading results override the server progress snapshot so answered
  // checkpoints stay answered without a refetch.
  const [results, setResults] = useState<Record<number, CheckpointAnswerResult>>({});
  // The option the listener actually chose (or -1 for a skip), kept locally so
  // the review can show "your answer" without the server echoing it.
  const [chosenAnswers, setChosenAnswers] = useState<Record<number, number>>({});
  const [activeCheckpoint, setActiveCheckpoint] = useState<number | null>(null);
  const [answering, setAnswering] = useState(false);
  const [checkpointError, setCheckpointError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  // Collapsed by default in both formats: podcast listeners do not need the
  // transcript on screen to listen, and lecture already treated it this way.
  const [showTranscript, setShowTranscript] = useState(false);
  const passedRef = useRef(false);
  const triggeredCheckpointRef = useRef<number | null>(null);

  const progress = useMemo(
    () =>
      episode.checkpoints.map((cp, i) => {
        const local = results[i];
        if (local) return { seen: true, correct: local.correct };
        return episode.progress[i] ?? { seen: false, correct: false };
      }),
    [episode, results],
  );

  const score = progress.filter((p) => p.correct).length;
  const complete = progress.every((p) => p.seen);

  const onQueueEnd = useCallback(() => {
    setFinished(true);
    setShowSummary(true);
    localStorage.removeItem(scopeKey(`nosey_lm_episode_${episode.module_id}`));
  }, [episode.module_id]);

  const speech = useEpisodeSpeech(episode, cast, userRate, onQueueEnd);

  // Persist the position as it moves (only meaningful once playback starts).
  const posKey = scopeKey(`nosey_lm_episode_${episode.module_id}`);
  const posKeyRef = useRef(posKey);
  posKeyRef.current = posKey;
  useEffect(() => {
    if (speech.chunkPos > 0) localStorage.setItem(posKeyRef.current, String(speech.chunkPos));
    else localStorage.removeItem(posKeyRef.current);
  }, [speech.chunkPos]);

  // The first checkpoint whose anchor turn the listener reached and has not
  // seen yet.
  const pendingCheckpoint = useMemo(() => {
    const turn = speech.currentTurn;
    for (let i = 0; i < episode.checkpoints.length; i++) {
      if (episode.checkpoints[i].after_turn <= turn && !progress[i].seen) return i;
    }
    return null;
  }, [episode.checkpoints, progress, speech.currentTurn]);

  // Stop the audio the moment a checkpoint becomes pending, then ask. The ref
  // prevents the same pending checkpoint re-triggering on every re-render.
  useEffect(() => {
    if (speech.speech !== "playing") return;
    if (pendingCheckpoint == null) return;
    if (triggeredCheckpointRef.current === pendingCheckpoint) return;
    triggeredCheckpointRef.current = pendingCheckpoint;
    speech.pause();
    setActiveCheckpoint(pendingCheckpoint);
    setCheckpointError(null);
  }, [pendingCheckpoint, speech, speech.speech]);

  async function handleCheckpointAnswer(choice: number) {
    if (activeCheckpoint == null || answering) return;
    setAnswering(true);
    setCheckpointError(null);
    try {
      const graded = await answerCheckpoint(episode.module_id, activeCheckpoint, choice);
      setResults((prev) => ({ ...prev, [activeCheckpoint]: graded }));
      setChosenAnswers((prev) => ({ ...prev, [activeCheckpoint]: choice }));
      // Whole-track celebration is owned by the parent via onModulePassed; the
      // player only reports that this module just completed and passed.
      if (graded.passed && graded.complete && !passedRef.current) {
        passedRef.current = true;
        onModulePassed?.();
      }
      setActiveCheckpoint(null);
      triggeredCheckpointRef.current = null;
      // Continue where it stopped. The stop was a hard cancel; replaying the
      // current chunk at most repeats a sentence.
      speech.startSpeechFrom(speech.chunkPos);
    } catch (err) {
      setCheckpointError(
        err instanceof Error ? err.message : "Could not grade that question. Try again.",
      );
    } finally {
      setAnswering(false);
    }
  }

  // ── Derived layout values ────────────────────────────────────────────────
  const estMinutes = useMemo(() => {
    const words = episode.turns.map((t) => t.text).join(" ").split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.round(words / 170));
  }, [episode]);

  const slideIndex = useMemo(() => {
    let index = 0;
    for (let i = 0; i < episode.slides.length; i++) {
      if (episode.slides[i].start_turn <= speech.currentTurn) index = i;
      else break;
    }
    return index;
  }, [episode.slides, speech.currentTurn]);

  const maxTurn = Math.max(0, episode.turns.length - 1);

  // Keep the speaking turn in view while playing (reduced-motion aware).
  useEffect(() => {
    if (speech.speech !== "playing") return;
    const el = document.getElementById(`lm-turn-${speech.currentTurn}`);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
  }, [speech.currentTurn, speech.speech]);

  function seekToTurn(turnIndex: number) {
    const chunk = speech.chunks.findIndex((c) => c.turnIndex >= turnIndex);
    speech.seekTo(chunk >= 0 ? chunk : speech.chunks.length - 1, true);
  }

  function jumpToCheckpoint(i: number) {
    // Jump slightly before the checkpoint's anchor so the material that
    // answers it is heard again ("Jump to that part" for missed questions).
    seekToTurn(Math.max(0, episode.checkpoints[i].after_turn - 2));
  }

  const lectureStageVisible = episode.format === "lecture" && activeCheckpoint == null && !showSummary;

  return (
    <div className="page page-narrow lm-episode">
      <header className="page-header mode-header">
        <Link
          className="flash-back-btn"
          to={`/flashcards/${folderId}/modules`}
          aria-label="Back to track"
          title="Back to track"
        >
          <ArrowLeft size={18} />
        </Link>
        <div className="lm-header-main">
          <span className="eyebrow">{episode.format === "podcast" ? "Podcast" : "Slide deck"}</span>
          <h1>{episode.title}</h1>
          <p className="muted small">About {estMinutes} min</p>
        </div>
      </header>

      {!speechUsable ? (
        <Card className="lm-speech-notice">
          <AlertCircle size={18} />
          <p>
            Audio playback is not available in this browser. You can still read the transcript and
            answer the checkpoint questions.
          </p>
        </Card>
      ) : null}

      {/* Checkpoint card replaces the surface it belongs to: the slide area in
          lecture, the artwork/transcript spot above the podcast transcript. */}
      {activeCheckpoint != null ? (
        <Card className="lm-checkpoint">
          <span className="eyebrow">Quick check</span>
          {(() => {
            const cp: EpisodeCheckpoint = episode.checkpoints[activeCheckpoint];
            const local = results[activeCheckpoint];
            const chosen = chosenAnswers[activeCheckpoint];
            return (
              <>
                <h2 className="lm-checkpoint-q">{cp.question}</h2>
                <div className="lm-checkpoint-options">
                  {cp.options.map((option, oIndex) => {
                    let stateClass = "";
                    if (local) {
                      if (oIndex === local.correct_index) stateClass = "is-correct";
                      else if (!local.correct && oIndex === chosen) stateClass = "is-wrong";
                    }
                    return (
                      <button
                        key={oIndex}
                        type="button"
                        className={`lm-checkpoint-option ${stateClass}`}
                        disabled={answering || local != null}
                        onClick={() => void handleCheckpointAnswer(oIndex)}
                      >
                        <span className="lm-checkpoint-option-letter">
                          {String.fromCharCode(65 + oIndex)}
                        </span>
                        <span>{option}</span>
                        {local && oIndex === local.correct_index ? <CheckCircle2 size={16} /> : null}
                        {local && !local.correct && oIndex === chosen ? <XCircle size={16} /> : null}
                      </button>
                    );
                  })}
                </div>
                {local ? (
                  <div className="lm-checkpoint-explain">
                    <p>{local.explanation}</p>
                  </div>
                ) : (
                  <button
                    className="lm-checkpoint-skip"
                    type="button"
                    disabled={answering}
                    onClick={() => void handleCheckpointAnswer(-1)}
                  >
                    Skip
                  </button>
                )}
                {local ? (
                  <div className="button-row">
                    <Button onClick={() => speech.startSpeechFrom(speech.chunkPos)}>Continue</Button>
                  </div>
                ) : null}
                <FormError message={checkpointError} />
              </>
            );
          })()}
        </Card>
      ) : null}

      {/* ── Player row: above the stage/transcript so the controls are the
          first thing reachable, not something to scroll past. ───────────── */}
      {!showSummary ? (
        <div className="lm-episode-player" role="group" aria-label="Episode player">
          <button
            className="lm-audio-toggle"
            type="button"
            onClick={() => {
              if (speech.speech === "playing") speech.pause();
              else speech.play();
            }}
            aria-label={speech.speech === "playing" ? "Pause episode" : "Play episode"}
            disabled={!speechUsable}
          >
            {speech.speech === "playing" ? <Pause size={20} /> : <Play size={20} />}
          </button>
          <div className="lm-audio-body">
            <div className="lm-audio-titles">
              <span className="lm-audio-format">
                {episode.format === "podcast" ? <Music2 size={14} /> : <Presentation size={14} />}
              </span>
              <span className="muted small">
                {speech.speech === "playing"
                  ? "Playing"
                  : speech.speech === "paused"
                    ? "Paused"
                    : speech.chunkPos > 0
                      ? "Resume where you left off"
                      : "Start listening"}
              </span>
            </div>
            <input
              className="lm-audio-seek"
              type="range"
              min={0}
              max={Math.max(0, speech.chunks.length - 1)}
              value={speech.chunkPos}
              aria-label="Seek position in the episode"
              onChange={(e) => speech.seekTo(Number(e.target.value), false)}
              onPointerUp={(e) => speech.seekTo(Number((e.target as HTMLInputElement).value), true)}
              onKeyUp={(e) => speech.seekTo(Number((e.target as HTMLInputElement).value), true)}
            />
            <div className="lm-checkpoint-marks" aria-hidden="true">
              {episode.checkpoints.map((cp, i) => (
                <span
                  key={i}
                  className={progress[i]?.seen ? (progress[i]?.correct ? "is-correct" : "is-missed") : ""}
                  title={`Checkpoint ${i + 1} at turn ${cp.after_turn}`}
                  style={{ left: `${maxTurn > 0 ? (cp.after_turn / maxTurn) * 100 : 0}%` }}
                />
              ))}
            </div>
          </div>
          <div className="lm-audio-rates" aria-label="Playback speed">
            {[0.75, 1, 1.25, 1.5, 2].map((option) => (
              <button
                key={option}
                type="button"
                className={`lm-audio-rate ${userRate === option ? "is-active" : ""}`}
                onClick={() => {
                  setUserRate(option);
                  speech.changeRate(option);
                }}
              >
                {option}x
              </button>
            ))}
          </div>
          {speech.chunkPos > 0 ? (
            <button
              className="lm-audio-restart"
              type="button"
              onClick={speech.restart}
              aria-label="Start over from the beginning"
              title="Start over"
            >
              <RotateCcw size={15} />
            </button>
          ) : null}
        </div>
      ) : null}

      {/* ── Checkpoint dots ─────────────────────────────────────────────── */}
      {!showSummary && episode.checkpoints.length > 1 ? (
        <div className="lm-checkpoint-dots" aria-label="Checkpoint progress">
          {episode.checkpoints.map((cp, i) => {
            const state = progress[i]?.seen
              ? progress[i]?.correct
                ? "correct"
                : "missed"
              : "not reached";
            return (
            <button
              key={i}
              type="button"
              className={
                progress[i]?.seen
                  ? progress[i]?.correct
                    ? "is-correct"
                    : "is-missed"
                  : "is-unreached"
              }
              aria-label={`Checkpoint ${i + 1}, ${state}`}
              title={`Checkpoint ${i + 1}, ${state}`}
              onClick={() => {
                if (progress[i]?.seen) return;
                if (speech.speech === "playing") speech.pause();
                setActiveCheckpoint(i);
              }}
            />
            );
          })}
        </div>
      ) : null}

      {/* ── Lecture: slide stage (the main surface) ─────────────────────── */}
      {lectureStageVisible ? (
        <Card className="lm-episode-stage">
          <div className="lm-slide">
            <h2 className="lm-slide-title">{episode.slides[slideIndex]?.title ?? ""}</h2>
            <ul className="lm-slide-bullets">
              {(episode.slides[slideIndex]?.bullets ?? []).map((bullet, i) => (
                <li key={i}>{bullet}</li>
              ))}
            </ul>
            {episode.slides[slideIndex]?.example ? (
              <pre className="lm-slide-example">{episode.slides[slideIndex].example}</pre>
            ) : null}
          </div>
          {episode.slides.length > 1 ? (
            <div className="lm-slide-footer">
              <span className="muted small">
                Slide {Math.min(slideIndex + 1, episode.slides.length)} of {episode.slides.length}
              </span>
              <div className="lm-slide-dots" aria-label="Jump to slide">
                {episode.slides.map((slide, i) => (
                  <button
                    key={i}
                    type="button"
                    className={i === slideIndex ? "is-active" : ""}
                    aria-label={`Slide ${i + 1}`}
                    title={slide.title}
                    onClick={() => seekToTurn(slide.start_turn)}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </Card>
      ) : null}

      {/* ── Transcript, collapsed by default in both formats: a podcast
          listener does not need it on screen to listen, and it stays one tap
          away for anyone who wants to read along or reread a line. ───────── */}
      {!showSummary ? (
        <Card className="lm-episode-transcript">
          <button
            className="lm-transcript-toggle"
            type="button"
            onClick={() => setShowTranscript((v) => !v)}
            aria-expanded={showTranscript}
          >
            {showTranscript ? "Hide transcript" : "Show transcript"}
          </button>
          {showTranscript ? (
            <div className="lm-transcript-body">
              {episode.turns.map((turn, i) => (
                <div
                  key={i}
                  id={`lm-turn-${i}`}
                  className={`lm-turn ${i === speech.currentTurn && speech.speech === "playing" ? "is-active" : ""}`}
                >
                  <span className={`lm-speaker-chip ${turn.speaker === "expert" ? "is-expert" : ""}`}>
                    {SPEAKER_LABELS[turn.speaker] ?? turn.speaker}
                  </span>
                  <p>{turn.text}</p>
                </div>
              ))}
            </div>
          ) : null}
        </Card>
      ) : null}

      {/* ── Summary entry: after the queue ends, or once every checkpoint is
          answered (covers the degraded no-audio path too). ─────────────── */}
      {!showSummary && (finished || complete) ? (
        <div className="button-row lm-summary-entry">
          <Button onClick={() => setShowSummary(true)}>View summary</Button>
        </div>
      ) : null}

      {/* ── End-of-episode summary ──────────────────────────────────────── */}
      {showSummary ? (
        <Card className="lm-episode-summary">
          <h2>Episode complete</h2>
          <p className="muted">
            {score} of {episode.total} checkpoints correct.{" "}
            {score >= episode.pass_threshold ? "Module passed." : "Review the ones you missed below."}
          </p>

          <div className="lm-checkpoint-review">
            {episode.checkpoints.map((cp, i) => {
              const local = results[i];
              const state = progress[i];
              return (
                <div key={i} className="lm-review-row">
                  <span className="lm-review-status">
                    {state.correct ? (
                      <CheckCircle2 size={16} className="is-correct" />
                    ) : state.seen ? (
                      <XCircle size={16} className="is-wrong" />
                    ) : (
                      <span className="lm-review-empty" aria-hidden="true" />
                    )}
                  </span>
                  <div className="lm-review-body">
                    <p className="lm-review-q">{cp.question}</p>
                    <p className="muted small">
                      {local ? (
                        <>
                          Your answer:{" "}
                          {chosenAnswers[i] != null && chosenAnswers[i] >= 0
                            ? cp.options[chosenAnswers[i]]
                            : "skipped"}
                          . Correct: {cp.options[local.correct_index]}. {local.explanation}
                        </>
                      ) : (
                        "Not answered yet."
                      )}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          {score >= episode.pass_threshold ? (
            <div className="lm-passed">
              <CheckCircle2 size={22} />
              <p>
                <strong>Module passed.</strong> Track progress is saved; the hub shows this as
                completed by listening.
              </p>
            </div>
          ) : (
            <div className="lm-missed-list">
              <h3>Review the ones you missed</h3>
              <p className="muted small">Answering them here re-grades without replaying the episode.</p>
              {episode.checkpoints.map((cp, i) => {
                if (progress[i]?.correct) return null;
                const local = results[i];
                return (
                  <Card key={i} className="lm-missed-card">
                    <div className="lm-missed-q">
                      <strong>{cp.question}</strong>
                      {local ? (
                        <span className="muted small">
                          {local.correct ? "Now correct" : "Still wrong"} · correct:{" "}
                          {cp.options[local.correct_index]}
                        </span>
                      ) : null}
                    </div>
                    <div className="lm-missed-actions">
                      <Button
                        variant="secondary"
                        icon={<RotateCcw size={15} />}
                        onClick={() => {
                          setShowSummary(false);
                          setActiveCheckpoint(i);
                          speech.pause();
                        }}
                      >
                        Answer again
                      </Button>
                      <button className="lm-jump-link" type="button" onClick={() => jumpToCheckpoint(i)}>
                        Jump to that part
                      </button>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}

          <div className="button-row">
            <Link to={`/flashcards/${folderId}/modules`}>
              <Button>Back to track</Button>
            </Link>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

// The route component: loads the episode and owns the "did this complete the
// whole track" check for confetti, so the player itself never re-derives track
// completion (spec decision).
export default function EpisodePlayer() {
  const { folderId, moduleId } = useParams();
  const numericFolderId = folderId ? Number(folderId) : null;
  const numericModuleId = moduleId ? Number(moduleId) : null;

  const [episode, setEpisode] = useState<ModuleEpisode | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { fire: fireConfetti, element: confettiElement } = useConfetti();
  const firedRef = useRef(false);

  useEffect(() => {
    if (numericModuleId == null) return;
    setEpisode(null);
    setLoaded(false);
    setError(null);
    fetchModuleEpisode(numericModuleId)
      .then(setEpisode)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load the episode."))
      .finally(() => setLoaded(true));
  }, [numericModuleId]);

  const handleModulePassed = useCallback(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    void (async () => {
      try {
        const track = await fetchTrackForModule(numericModuleId ?? 0);
        if (track && track.modules.length > 0 && track.modules.every((m) => m.passed)) {
          fireConfetti();
        }
      } catch {
        // Confetti is a nicety; a fetch failure must not surface as an error.
      }
    })();
  }, [numericModuleId, fireConfetti]);

  if (numericFolderId == null || numericModuleId == null) {
    return <Navigate to="/flashcards" replace />;
  }

  if (!loaded) {
    return (
      <div className="page page-narrow">
        <SkeletonText lines={7} label="Loading the episode" />
      </div>
    );
  }

  if (error || !episode) {
    return (
      <div className="page page-narrow">
        <Card className="lm-failed">
          <div>
            <strong>This episode is not available.</strong>
            <p className="muted small">
              {error ?? "It may still be generating, or the track was rebuilt."}
            </p>
          </div>
          <Link to={`/flashcards/${numericFolderId}/modules`}>
            <Button variant="secondary">Back to track</Button>
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <>
      <EpisodePlayerInner episode={episode} folderId={numericFolderId} onModulePassed={handleModulePassed} />
      {confettiElement}
    </>
  );
}