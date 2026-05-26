import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";

interface Props {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function CollapsibleSection({ title, defaultOpen = false, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={`settings-collapsible${open ? " settings-collapsible--open" : ""}`}>
      <button
        type="button"
        className="settings-collapsible-header"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="settings-collapsible-title">{title}</span>
        <ChevronDown size={16} className="settings-collapsible-chevron" />
      </button>
      {open && <div className="settings-collapsible-body">{children}</div>}
    </div>
  );
}
