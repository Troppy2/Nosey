import { useEffect, useState } from "react";

const ROTATE_MS = 5000;

/**
 * One line under Kojo's message box that alternates between the keyboard hint
 * and the AI disclaimer, so adding the disclaimer doesn't add a second line.
 */
export function KojoHintCarousel({ hint, className }: { hint: string; className: string }) {
  const messages = [hint, "Kojo is AI and can make mistakes."];
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setIndex((i) => (i + 1) % messages.length), ROTATE_MS);
    return () => window.clearInterval(timer);
  }, [messages.length]);

  return (
    <p className={`${className} kojo-hint-carousel`}>
      {/* Keyed so each swap fades in. */}
      <span key={index} className="kojo-hint-carousel-item">
        {messages[index]}
      </span>
    </p>
  );
}
