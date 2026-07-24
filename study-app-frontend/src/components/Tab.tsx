import type { MouseEvent } from "react";
import { Lock } from "lucide-react";

export type CodingTabItem = {
    id: string;
    name: string;
    active?: boolean;
    // Locked while a 3-Pass Drill is open: not selectable (code hidden) and not deletable.
    locked?: boolean;
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
                    return (
                        <button
                            key={tab.id}
                            type="button"
                            className={`lc-coding-tab${isActive ? " lc-coding-tab--active" : ""}${locked ? " lc-coding-tab--locked" : ""}`}
                            onClick={() => { if (!locked) onSelectTab(tab.id); }}
                            role="tab"
                            aria-selected={isActive}
                            disabled={locked}
                            aria-disabled={locked}
                            title={locked ? "Locked while you drill" : undefined}
                        >
                            <span>{tab.name}</span>
                            {locked ? (
                                <Lock size={12} className="lc-coding-tab-lock" aria-hidden="true" />
                            ) : isActive ? (
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