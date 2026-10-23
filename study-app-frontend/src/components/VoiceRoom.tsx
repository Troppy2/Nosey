import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeftIcon, ChatIcon } from "../icons";
import type { InterviewChatMessage } from "../lib/types";
import { useInterviewerVoice } from "../lib/voice";
import { VoiceAnswerBar } from "./VoiceAnswerBar";
import "../styles/components/voice-room.css";

type Props = {
  title: string;
  subtitle: string;
  interviewerName: string;
  messages: InterviewChatMessage[];
  covered: number;
  total: number;
  waiting: boolean;
  done: boolean;
  onSend: (text: string) => void;
  onLeave: () => void;
  doneAction?: ReactNode;
  /** Where the loop goes next. Called on its own once the interviewer has wrapped up. */
  onAdvance?: () => void;
  /** Label for the next stop, e.g. "the behavioral round" or "your debrief". */
  nextLabel?: string;
  /** Replaces the interviewer stage with a work surface (the technical round's problem and editor). */
  workspace?: ReactNode;
  /** Header slot before the transcript toggle, e.g. the technical round's clock and End round. */
  headerExtra?: ReactNode;
  /** Names each step instead of "Question n of N" (the technical round's phases). */
  stepNames?: string[];
  voice: ReturnType<typeof useInterviewerVoice>;
};

/** Full-screen voice round: the interviewer's latest line, the controls and a running transcript. */
export function VoiceRoom({
  title, subtitle, interviewerName, messages, covered, total, waiting, done, onSend, onLeave, doneAction, onAdvance, nextLabel = "the next round", workspace, headerExtra, stepNames, voice,
}: Props) {
  const threadRef = useRef<HTMLDivElement>(null);
  const lastInterviewer = [...messages].reverse().find((m) => m.role === "interviewer");
  const lastIsInterviewer = messages[messages.length - 1]?.role === "interviewer";
  // Transcript starts hidden so the question has the room; the header button opens it.
  const [showTranscript, setShowTranscript] = useState(false);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, waiting, showTranscript]);

  // A reopened round still owes the candidate the open question out loud.
  useEffect(() => {
    if (!done && lastIsInterviewer && lastInterviewer) void voice.speak(lastInterviewer.content);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Self-advance: when the round finishes while you are in it, let the interviewer's
  // last line play out, then move on after a short beat. A round that was already
  // finished when opened does not jump away.
  const [advanceIn, setAdvanceIn] = useState<number | null>(null);
  const finishedLive = useRef(false);
  const wasDone = useRef(done);
  useEffect(() => {
    if (done && !wasDone.current) finishedLive.current = true;
    wasDone.current = done;
  }, [done]);
  useEffect(() => {
    if (!finishedLive.current || !onAdvance || voice.speaking || voice.blocked || advanceIn !== null) return;
    setAdvanceIn(4);
  }, [done, voice.speaking, voice.blocked, onAdvance, advanceIn]);
  useEffect(() => {
    if (advanceIn === null || advanceIn < 0) return;
    if (advanceIn === 0) {
      onAdvance?.();
      return;
    }
    const t = window.setTimeout(() => setAdvanceIn((n) => (n === null ? null : n - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [advanceIn, onAdvance]);

  const answerBar = done ? (
    advanceIn !== null && advanceIn >= 0 ? (
      <div className="voice-advance" role="status">
        <p>
          Moving to {nextLabel} in {advanceIn}s
        </p>
        <button type="button" className="voice-stay" onClick={() => setAdvanceIn(-1)}>
          Stay here
        </button>
      </div>
    ) : (
      <p className="voice-done">This round is complete.</p>
    )
  ) : (
    <VoiceAnswerBar
      onSend={onSend}
      disabled={waiting}
      muted={voice.muted}
      onToggleMute={() => voice.setMuted(!voice.muted)}
      onStartTalking={voice.stop}
      speaking={voice.speaking}
    />
  );

  return (
    <div
      className={`voice-room${workspace ? " voice-room--work" : ""}${showTranscript ? "" : " voice-room--no-transcript"}`}
    >
      <header className="voice-head">
        <div className="voice-head-left">
          <button type="button" className="voice-leave" onClick={onLeave} aria-label="Leave the round, progress is saved">
            <ArrowLeftIcon size={18} />
          </button>
          <div className="voice-head-title">
            <span>{title}</span>
            <small>{subtitle}</small>
          </div>
        </div>
        <ol className="voice-steps" aria-label={`${covered} of ${total} questions covered`}>
          {Array.from({ length: total }, (_, i) => (
            <li key={i} className={i < covered ? "is-done" : i === covered && !done ? "is-now" : ""} />
          ))}
        </ol>
        <div className="voice-head-right">
          {done ? (
            doneAction
          ) : (
            <span className="voice-steps-label">
              {stepNames
                ? stepNames[Math.min(covered, stepNames.length - 1)]
                : `Question ${Math.min(covered + 1, total)} of ${total}`}
            </span>
          )}
          {headerExtra}
          <button
            type="button"
            className={`voice-transcript-toggle${showTranscript ? " is-on" : ""}`}
            onClick={() => setShowTranscript((v) => !v)}
            aria-expanded={showTranscript}
            aria-controls="voice-transcript"
          >
            <ChatIcon size={16} />
            {showTranscript ? "Hide transcript" : "Show transcript"}
          </button>
        </div>
      </header>

      <div className="voice-body">
        {workspace ? (
          <section className="voice-work" aria-label="Problem and editor">
            {workspace}
          </section>
        ) : (
          <section className="voice-stage" aria-label="Interviewer">
            <button
              type="button"
              className={`voice-orb${voice.speaking ? " is-speaking" : ""}`}
              onClick={() => lastInterviewer && void voice.speak(lastInterviewer.content)}
              aria-label="Play the question again"
              title="Play the question again"
            >
              {[0, 1, 2, 3, 4].map((i) => (
                <span key={i} style={{ "--i": i } as React.CSSProperties} />
              ))}
            </button>
            <div className="voice-prompt">
              <span className="voice-prompt-status">
                {waiting
                  ? `${interviewerName} is thinking`
                  : voice.blocked
                    ? "Tap anywhere to hear the question"
                    : voice.speaking
                      ? `${interviewerName} is asking`
                      : interviewerName}
              </span>
              <p>{lastInterviewer?.content ?? ""}</p>
            </div>
            {answerBar}
          </section>
        )}

        {(showTranscript || workspace) && (
        <aside className="voice-transcript" id="voice-transcript" aria-label="Transcript">
          {showTranscript && (
          <>
          <div className="voice-transcript-head">
            <h2>Transcript</h2>
            <span>Saved as you talk</span>
          </div>
          <div className="voice-transcript-body" ref={threadRef}>
            {messages.map((m, i) => (
              <div key={i} className="voice-line">
                <span>{m.role === "interviewer" ? "Interviewer" : "You"}</span>
                <p>{m.content}</p>
              </div>
            ))}
            {waiting && (
              <div className="voice-line">
                <span>Interviewer</span>
                <p className="voice-line-wait">Thinking...</p>
              </div>
            )}
          </div>
          </>
          )}
          {workspace && !showTranscript && (
            <div className="voice-work-prompt">
              <span className="voice-prompt-status">
                {waiting ? `${interviewerName} is thinking` : voice.speaking ? `${interviewerName} is talking` : interviewerName}
              </span>
              <p>{lastInterviewer?.content ?? ""}</p>
            </div>
          )}
          {workspace && <div className="voice-transcript-answer">{answerBar}</div>}
        </aside>
        )}
      </div>
    </div>
  );
}
