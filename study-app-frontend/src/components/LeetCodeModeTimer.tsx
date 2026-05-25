import { Timer } from "lucide-react";

interface LeetCodeModeTimerProps {
    remainingSeconds?: number | null;
}

function formatTime(totalSeconds: number) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export default function LeetCodeModeTimer({ remainingSeconds }: LeetCodeModeTimerProps) {
    if (remainingSeconds == null) return null;

    const totalSeconds = Math.max(0, Math.floor(remainingSeconds));

    return (
        <div className={totalSeconds <= 60 ? "lc-toolbar-timer lc-toolbar-timer--urgent" : "lc-toolbar-timer"}>
            <Timer size={16} />
            {formatTime(totalSeconds)}
        </div>
    );
}

