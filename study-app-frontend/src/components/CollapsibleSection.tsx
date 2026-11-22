import { ChevronDownIcon } from "../icons";
import { useId, useState, type ReactNode } from "react";

interface Props {
  title: string;
  defaultOpen?: boolean;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}

export function CollapsibleSection({ title, defaultOpen = false, open: controlledOpen, onOpenChange, children }: Props) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const open = controlledOpen ?? internalOpen;
  const contentId = useId();

  return (
    <div className={`settings-collapsible${open ? " settings-collapsible--open" : ""}`}>
      <button
        type="button"
        className="settings-collapsible-header"
        onClick={() => {
          if (controlledOpen === undefined) setInternalOpen(!open);
          onOpenChange?.(!open);
        }}
        aria-expanded={open}
        aria-controls={open ? contentId : undefined}
      >
        <span className="settings-collapsible-title">{title}</span>
        <ChevronDownIcon size={16} className="settings-collapsible-chevron" />
      </button>
      {open && <div id={contentId} className="settings-collapsible-body">{children}</div>}
    </div>
  );
}
