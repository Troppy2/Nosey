import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { ArrowLeftIcon, PlayIcon } from "../icons";
import { speakInterviewer } from "../lib/api";
import { loadInterviewerVoice, saveInterviewerVoice, VOICE_OPTIONS, type InterviewerVoiceId } from "../lib/voice";
import { Dropdown } from "./Dropdown";
import "../styles/components/voice-start.css";

const SAMPLE = "Hi, I'm Kojo. I'll be your interviewer today.";

/** Kojo's voice picker with a short preview. The choice is remembered for every round. */
export function VoicePicker({ compact }: { compact?: boolean }) {
  const [voice, setVoice] = useState<InterviewerVoiceId>(loadInterviewerVoice);
  const [previewing, setPreviewing] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => () => audioRef.current?.pause(), []);

  function choose(next: InterviewerVoiceId) {
    setVoice(next);
    saveInterviewerVoice(next);
  }

  async function preview() {
    audioRef.current?.pause();
    setPreviewing(true);
    try {
      const blob = await speakInterviewer(SAMPLE, voice);
      const audio = new Audio(URL.createObjectURL(blob));
      audioRef.current = audio;
      audio.onended = () => URL.revokeObjectURL(audio.src);
      await audio.play();
    } catch {
      /* preview is best effort */
    } finally {
      setPreviewing(false);
    }
  }

  return (
    <div className={`voice-picker${compact ? " voice-picker--compact" : ""}`}>
      <Dropdown label="Kojo's voice" value={voice} options={[...VOICE_OPTIONS]} onChange={choose} bare={compact} />
      <button type="button" className="button button-ghost voice-picker-preview" onClick={preview} disabled={previewing}>
        {previewing ? <Loader2 size={14} className="spin" /> : <PlayIcon size={14} />}
        Preview
      </button>
    </div>
  );
}

/** Shown before a voice round starts: pick Kojo's voice, then start when ready. The
 *  Start click also lets the browser play Kojo's first line out loud. */
export function VoiceStartCard({
  title,
  subtitle,
  points,
  onStart,
  onBack,
}: {
  title: string;
  subtitle: string;
  points: string[];
  onStart: () => void;
  onBack: () => void;
}) {
  return (
    <div className="page page-narrow voice-start">
      <button type="button" className="button button-ghost voice-start-back" onClick={onBack}>
        <ArrowLeftIcon size={15} /> Back
      </button>
      <section className="card voice-start-card">
        <span className="eyebrow">{subtitle}</span>
        <h1>{title}</h1>
        <ul>
          {points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <VoicePicker />
        <button type="button" className="button button-primary voice-start-go" onClick={onStart}>
          Start interview
        </button>
      </section>
    </div>
  );
}
