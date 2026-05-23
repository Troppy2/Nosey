export type CodingTabItem = {
    id: string;
    name: string;
    active?: boolean;
};

type CodingTabsProps = {
    tabs: CodingTabItem[];
    activeTabId: string;
    onSelectTab: (tabId: string) => void;
    onAddTab: () => void;
    onDeleteTab: (tabId: string) => void;
};

export default function CodingTabs({ tabs, activeTabId, onSelectTab, onAddTab, onDeleteTab }: CodingTabsProps) {
    return (
        <div className="lc-code-tabs" role="tablist" aria-label="Coding tabs">
            <div className="lc-code-tabs__list">
                {tabs.map((tab) => {
                    const isActive = tab.active ?? tab.id === activeTabId;
                    return (
                        <button
                            key={tab.id}
                            type="button"
                            className={isActive ? "lc-coding-tab lc-coding-tab--active" : "lc-coding-tab"}
                            onClick={() => onSelectTab(tab.id)}
                            role="tab"
                            aria-selected={isActive}
                        >
                            <span>{tab.name}</span>
                            {isActive ? (
                                <span
                                    className="closeTab"
                                    role="button"
                                    aria-label={`Delete ${tab.name}`}
                                    onClick={(event) => {
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
            
            <button type="button" className="lc-coding-tab lc-coding-tab--add" onClick={onAddTab}>
                + New Tab
            </button>
        </div>
    );
}