import { useEffect, useRef, useState } from "react";
import { ChevronDownIcon } from "../icons";
import "../styles/components/folder-summary.css";

/** A folder's description, clamped to two lines with a chevron to open it.
 * The chevron only shows when the text is actually cut off. */
export function FolderSummary({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 2);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => observer?.disconnect();
  }, [text, open]);

  return (
    <div className={`folder-summary${open ? " folder-summary--open" : ""}`}>
      <p className="muted folder-summary-text" ref={ref}>
        {text}
      </p>
      {overflows || open ? (
        <button
          aria-expanded={open}
          aria-label={open ? "Show less of the folder summary" : "Show the full folder summary"}
          className="folder-summary-toggle"
          onClick={() => setOpen((value) => !value)}
          type="button"
        >
          <ChevronDownIcon size={18} />
        </button>
      ) : null}
    </div>
  );
}
