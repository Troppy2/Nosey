import { useEffect, useRef, useState } from "react";
import { KeyboardIcon, MicIcon, SpeakerIcon } from "../icons";
import { useDictation } from "../lib/voice";
import "../styles/components/voice-room.css";

type Props = {
  onSend: (text: string) => void;
  /** Fires when the mic starts or stops recording. */
  onListeningChange?: (listening: boolean) => void;
  disabled?: boolean;
  muted: boolean;
  onToggleMute: () => void;
  onStartTalking?: () => void;
  speaking?: boolean;
  placeholder?: string;
};

/** Mic, mute and keyboard controls plus a live transcript. The draft is always editable by switching to the keyboard. */
export function VoiceAnswerBar({
  onSend, onListeningChange, disabled, muted, onToggleMute, onStartTalking, speaking, placeholder,
}: Props) {
  const [draft, setDraftState] = useState("");
  // The draft as of the last dictation callback, read by send() after it waits for
  // the mic to finish (state from that render would miss the last words).
  const draftRef = useRef("");
  const setDraft = (next: string | ((d: string) => string)) =>
    setDraftState((d) => {
      const value = typeof next === "function" ? next(d) : next;
      draftRef.current = value;
      return value;
    });
  const [typing, setTyping] = useState(false);
  // Send was pressed while the mic was still live: waiting for the last words.
  const [finishing, setFinishing] = useState(false);
  const dictation = useDictation((text) => setDraft((d) => (d ? `${d} ${text}` : text)));
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (typing) areaRef.current?.focus();
  }, [typing]);

  useEffect(() => {
    onListeningChange?.(dictation.listening);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dictation.listening]);

  function toggleTalk() {
    if (dictation.listening) {
      dictation.stop();
      return;
    }
    onStartTalking?.();
    void dictation.start();
  }

  // Never send half an answer: when the mic is still live (or the fallback is still
  // transcribing), stop it and wait until every word has landed in the draft.
  async function send() {
    if (disabled || finishing) return;
    if (dictation.listening || dictation.transcribing) {
      setFinishing(true);
      try {
        await dictation.finish();
      } finally {
        setFinishing(false);
      }
    }
    const text = draftRef.current.trim();
    if (!text) return;
    onSend(text);
    setDraft("");
  }

  const status = disabled
    ? "Waiting for the interviewer"
    : finishing || dictation.transcribing
      ? "Finishing your answer"
      : dictation.listening
      ? "Listening"
      : speaking
        ? ""
        : "Your turn";

  return (
    <div className="voice-bar">
      <span className="voice-bar-status" aria-live="polite">
        {status}
      </span>

      {(draft || dictation.interim) && !typing && (
        <p className="voice-bar-live" aria-label="Your answer so far">
          {draft}
          {dictation.interim && <span className="voice-bar-interim"> {dictation.interim}</span>}
        </p>
      )}

      {typing && (
        <textarea
          ref={areaRef}
          className="voice-bar-text"
          rows={4}
          value={draft}
          placeholder={placeholder ?? "Type your answer"}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          disabled={disabled}
        />
      )}

      {dictation.error && <span className="voice-bar-error">{dictation.error}</span>}

      <div className="voice-bar-controls">
        <button
          type="button"
          className="voice-btn voice-btn-small"
          onClick={onToggleMute}
          aria-pressed={muted}
          aria-label={muted ? "Turn interviewer voice on" : "Mute interviewer voice"}
        >
          <SpeakerIcon size={20} />
          {muted && <span className="voice-btn-slash" aria-hidden="true" />}
        </button>
        <button
          type="button"
          className={`voice-btn voice-btn-mic${dictation.listening ? " is-on" : ""}`}
          style={{ "--level": dictation.level } as React.CSSProperties}
          onClick={toggleTalk}
          disabled={disabled || finishing || dictation.transcribing || !dictation.supported}
          aria-label={dictation.listening ? "Stop recording" : "Start answering"}
        >
          <MicIcon size={30} />
        </button>
        <button
          type="button"
          className={`voice-btn voice-btn-small${typing ? " is-on" : ""}`}
          onClick={() => setTyping((v) => !v)}
          aria-pressed={typing}
          aria-label="Type instead"
        >
          <KeyboardIcon size={20} />
        </button>
      </div>

      {(draft.trim() || typing || dictation.interim || finishing) && (
        <button
          type="button"
          className="voice-send"
          onClick={() => void send()}
          disabled={disabled || finishing || dictation.transcribing || (!draft.trim() && !dictation.listening)}
        >
          {finishing ? "Finishing..." : "Send answer"}
        </button>
      )}
    </div>
  );
}
