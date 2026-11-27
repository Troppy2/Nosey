import { useEffect, useRef } from "react";
import { Lock } from "lucide-react";
import { CloseIcon, PlusIcon } from "../icons";

export { Lock as CodingLock };

export type CodingTabItem = {
  id: string;
  name: string;
  active?: boolean;
  locked?: boolean;
  closable?: boolean;
  lockTitle?: string;
};
type CodingTabsProps = {
  tabs: CodingTabItem[];
  activeTabId: string;
  onSelectTab: (tabId: string) => void;
  onAddTab: () => void;
  onDeleteTab: (tabId: string) => void;
  canAddTab?: boolean;
};
export default function CodingTabs({ tabs, activeTabId, onSelectTab, onAddTab, onDeleteTab, canAddTab = true }: CodingTabsProps) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Scroll only the file strip, never the page or its enclosing dock.
    const active = list.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    const scroller = list.current;
    if (!active || !scroller) return;
    const a = active.getBoundingClientRect(), b = scroller.getBoundingClientRect();
    if (a.left < b.left) scroller.scrollLeft -= b.left - a.left;
    else if (a.right > b.right) scroller.scrollLeft += a.right - b.right;
  }, [activeTabId]);
  return (
    <div className="lc-code-tabs">
      <div ref={list} className="lc-code-tabs__list" role="tablist" aria-label="Coding tabs">
        {tabs.map((tab) => {
          const active = tab.active ?? tab.id === activeTabId;
          const locked = Boolean(tab.locked);
          // The only open file has no close button: closing it would wipe the code.
          const closable = locked ? Boolean(tab.closable) : tabs.length > 1;
          return (
            <div key={tab.id} role="presentation" className={"lc-file-tab" + (active ? " is-active" : "")}>
              <button
                type="button" role="tab" aria-selected={active}
                tabIndex={active ? 0 : -1}
                className={"lc-coding-tab" + (active ? " lc-coding-tab--active" : "") + (locked ? " lc-coding-tab--locked" : "")}
                disabled={locked}
                title={locked ? tab.lockTitle ?? "Locked while you drill" : tab.name}
                onClick={() => onSelectTab(tab.id)}
                onKeyDown={(event) => {
                  const available = tabs.filter((t) => !t.locked);
                  const index = available.findIndex((t) => t.id === tab.id);
                  const offsets: Record<string, number> = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: available.length - 1 };
                  if (!(event.key in offsets) || !available.length) return;
                  event.preventDefault();
                  const next = available[(offsets[event.key] + available.length) % available.length];
                  onSelectTab(next.id);
                  requestAnimationFrame(() => {
                    const buttons = list.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
                    buttons?.[tabs.findIndex((t) => t.id === next.id)]?.focus();
                  });
                }}
              >
                <span>{tab.name}</span>
                {locked ? <Lock size={12} aria-hidden="true" /> : null}
              </button>
              {closable ? <button type="button" className="lc-file-close" aria-label={"Delete " + tab.name} title={"Delete " + tab.name} onClick={() => onDeleteTab(tab.id)}><CloseIcon size={12} /></button> : null}
            </div>
          );
        })}
      </div>
      <button type="button" className="lc-coding-tab lc-coding-tab--add" onClick={onAddTab} disabled={!canAddTab} aria-label="New tab" title="New tab">
        <PlusIcon size={16} />
      </button>
    </div>
  );
}
