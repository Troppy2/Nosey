import { useEffect, useState } from "react";

const ROTATE_MS = 5000;
const DISCLAIMER = "Kojo is AI and can make mistakes.";

/**
 * One line under Kojo's message box that alternates between the keyboard hint
 * and the AI disclaimer. Both messages sit in the same grid cell, so the line
 * is always as wide as the longer one and its text never shifts on a swap;
 * only opacity changes.
 */
export function KojoHintCarousel({ hint, className }: { hint: string; className: string }) {
  const messages = [hint, DISCLAIMER];
  const [active, setActive] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setActive((i) => (i + 1) % messages.length), ROTATE_MS);
    return () => window.clearInterval(timer);
  }, [messages.length]);

  return (
    <p className={`${className} kojo-hint-carousel`}>
      {messages.map((message, i) => (
        <span
          key={message}
          className={`kojo-hint-carousel-item${i === active ? " is-active" : ""}`}
          aria-hidden={i !== active}
        >
          {message}
        </span>
      ))}
    </p>
  );
}
