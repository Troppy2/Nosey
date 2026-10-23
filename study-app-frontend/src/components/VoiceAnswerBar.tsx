import { useEffect, useRef, useState } from "react";
import { KeyboardIcon, MicIcon, SpeakerIcon } from "../icons";
import { useDictation } from "../lib/voice";
import "../styles/components/voice-room.css";

type Props = {
  onSend: (text: string) => void;
  disabled?: boolean;
  muted: boolean;
  onToggleMute: () => void;
  onStartTalking?: () => void;
  speaking?: boolean;
  placeholder?: string;
};

/** Mic, mute and keyboard controls plus a live transcript. The draft is always editable by switching to the keyboard. */
export function VoiceAnswerBar({ onSend, disabled, muted, onToggleMute, onStartTalking, speaking, placeholder }: Props) {
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  const dictation = useDictation((text) => setDraft((d) => (d ? `${d} ${text}` : text)));
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (typing) areaRef.current?.focus();
  }, [typing]);

  function toggleTalk() {
    if (dictation.listening) {
      dictation.stop();
      return;
    }
    onStartTalking?.();
    void dictation.start();
  }

  function send() {
    const text = draft.trim();
    if (!text || disabled) return;
    if (dictation.listening) dictation.stop();
    onSend(text);
    setDraft("");
  }

  const status = disabled
    ? "Waiting for the interviewer"
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
              send();
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
          disabled={disabled || !dictation.supported}
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

      {(draft.trim() || typing) && (
        <button type="button" className="voice-send" onClick={send} disabled={disabled || !draft.trim()}>
          Send answer
        </button>
      )}
    </div>
  );
}
