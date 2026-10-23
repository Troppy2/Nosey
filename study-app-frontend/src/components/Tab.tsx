import type { MouseEvent } from "react";
import { Lock } from "lucide-react";

export type CodingTabItem = {
    id: string;
    name: string;
    active?: boolean;
    // Locked while a 3-Pass Drill is open (not selectable, not deletable) or while a prep
    // bank run is pending (not selectable, but closable: see closable).
    locked?: boolean;
    // A locked tab that can still be closed. Prep bank locks only hide old answers.
    closable?: boolean;
    // Tooltip on a locked tab.
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
    return (
        <div className="lc-code-tabs" role="tablist" aria-label="Coding tabs">
            <div className="lc-code-tabs__list">
                {tabs.map((tab) => {
                    const isActive = tab.active ?? tab.id === activeTabId;
                    const locked = Boolean(tab.locked);
                    const closableWhileLocked = locked && Boolean(tab.closable);
                    return (
                        <button
                            key={tab.id}
                            type="button"
                            className={`lc-coding-tab${isActive ? " lc-coding-tab--active" : ""}${locked ? " lc-coding-tab--locked" : ""}`}
                            onClick={() => { if (!locked) onSelectTab(tab.id); }}
                            role="tab"
                            aria-selected={isActive}
                            // A disabled button swallows clicks on its children, so a closable
                            // locked tab stays enabled and the onClick guard keeps it unselectable.
                            disabled={locked && !closableWhileLocked}
                            aria-disabled={locked}
                            title={locked ? tab.lockTitle ?? "Locked while you drill" : undefined}
                        >
                            <span>{tab.name}</span>
                            {locked ? (
                                <Lock size={12} className="lc-coding-tab-lock" aria-hidden="true" />
                            ) : null}
                            {closableWhileLocked || (!locked && isActive) ? (
                                <span
                                    className="closeTab"
                                    role="button"
                                    aria-label={`Delete ${tab.name}`}
                                    onClick={(event: MouseEvent<HTMLSpanElement>) => {
                                        event.stopPropagation();
                                        onDeleteTab(tab.id);
                                    }}
                                >
                                    X
                                </span>
                            ) : null}
                        </button>
                    );
                })}
            </div>

            <button type="button" className="lc-coding-tab lc-coding-tab--add" onClick={onAddTab} disabled={!canAddTab} aria-disabled={!canAddTab}>
                + New Tab
            </button>
        </div>
    );
}