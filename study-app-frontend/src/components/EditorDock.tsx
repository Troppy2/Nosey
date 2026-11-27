import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { CodingLock } from "./Tab";
import { DescriptionIcon, SolutionsIcon, ChatIcon, NotebookIcon, HistoryIcon, CodeIcon, TestcaseIcon, TerminalIcon, ComplexityIcon, ChevronDownIcon } from "../icons";
import { scopeKey } from "../lib/api";
import { useMobileShell } from "../lib/useMobileShell";
import { initialLayout, panels, readFixedLayout, reduceLayout, tabs, type Action, type Tab, type Panel, type Node } from "../lib/editorLayout";
import "../styles/components/editor-dock.css";
const icons = { Description: DescriptionIcon, Solutions: SolutionsIcon, Kojo: ChatIcon, Notes: NotebookIcon, Submissions: HistoryIcon, Code: CodeIcon, Testcase: TestcaseIcon, "Test result": TerminalIcon, Complexity: ComplexityIcon };
const phoneTabs: Tab[] = ["Description", "Code", "Testcase", "Test result", "Solutions", "Kojo", "Notes", "Submissions", "Complexity"];
function panelName(panel: Panel) { return panel.tabs[0] + " panel"; }
const tabName = (tab: Tab) => (tab === "Testcase" ? "Test cases" : tab);
type MenuItem = {
  key: string;
  label: ReactNode;
  icon?: ReactNode;
  trail?: ReactNode;
  onSelect: () => void;
};
type MenuSection = { title?: string; items: MenuItem[]; row?: boolean };
/** Overflow tabs use a keyboard-operable menu:
    arrow keys move between items, Escape closes and returns focus. */
function DockMenu({
  label,
  sections,
  onClose,
  className = "",
}: {
  label: string;
  sections: MenuSection[];
  onClose: (refocus: boolean) => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, []);
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      className={"lc-dock-pop " + className}
      onKeyDown={(e) => {
        const items = Array.from(
          ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
        );
        const index = items.indexOf(document.activeElement as HTMLElement);
        const next: Record<string, number> = {
          ArrowDown: index + 1,
          ArrowRight: index + 1,
          ArrowUp: index - 1,
          ArrowLeft: index - 1,
          Home: 0,
          End: items.length - 1,
        };
        if (e.key in next && items.length) {
          e.preventDefault();
          e.stopPropagation();
          items[(next[e.key] + items.length) % items.length].focus();
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose(true);
        } else if (e.key === "Tab") onClose(false);
      }}
    >
      {sections
        .filter((s) => s.items.length)
        .map((s, i) => (
          <div
            key={s.title ?? i}
            role="group"
            aria-label={s.title}
            className={"lc-dock-menu-group" + (s.row ? " is-row" : "")}
          >
            {s.title && (
              <div className="lc-dock-menu-title" aria-hidden="true">
                {s.title}
              </div>
            )}
            <div className="lc-dock-menu-items">
              {s.items.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  className="lc-dock-menu-item"
                  onClick={item.onSelect}
                >
                  {item.icon}
                  <span>{item.label}</span>
                  {item.trail}
                </button>
              ))}
            </div>
          </div>
        ))}
    </div>
  );
}
/** Closes a menu on a pointer press outside `box`. */
function useOutsideClose(open: boolean, box: React.RefObject<HTMLElement>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    function outside(e: PointerEvent) {
      if (!box.current?.contains(e.target as HTMLElement)) close();
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, box, close]);
}
type Contents = Record<Tab, ReactNode>;
type Locks = Partial<Record<Tab, string>>;
function DockPanel({ panel, locks, select, attach, reorder, mobile }: {
  panel: Panel;
  locks: Locks;
  select: (tab: Tab) => void;
  attach: (tab: Tab, element: HTMLDivElement | null) => void;
  reorder: (tab: Tab, before?: Tab) => void;
  mobile: boolean;
}) {
  const header = useRef<HTMLElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const dragging = useRef<Tab | null>(null);
  const [dropBefore, setDropBefore] = useState<Tab | null>(null);
  const [open, setOpen] = useState(false);
  const [width, setWidth] = useState(0);
  const [sizes, setSizes] = useState<number[]>([]);
  useOutsideClose(open, header, () => setOpen(false));
  useLayoutEffect(() => {
    const update = () => {
      setWidth(strip.current?.getBoundingClientRect().width ?? 0);
      setSizes(Array.from(measure.current?.children ?? []).map((element) => element.getBoundingClientRect().width));
    };
    const observer = new ResizeObserver(update);
    if (strip.current) observer.observe(strip.current);
    // Watch each measured tab, not just the row: the row is capped at the strip's width,
    // so a tab growing (the web font arriving, a style change) would not resize it.
    for (const tab of Array.from(measure.current?.children ?? [])) observer.observe(tab);
    update();
    return () => observer.disconnect();
  }, [panel.tabs, locks]);
  const total = sizes.slice(0, panel.tabs.length).reduce((sum, size) => sum + size, 0);
  let room = width - (total > width - 4 ? sizes[panel.tabs.length] ?? 80 : 0) - 4;
  const visible: Tab[] = [];
  for (const [index, tab] of panel.tabs.entries()) {
    if (width && (sizes[index] ?? 0) > room) break;
    visible.push(tab);
    room -= sizes[index] ?? 0;
  }
  const hidden = panel.tabs.filter((tab) => !visible.includes(tab));
  function choose(tab: Tab, focus = false) {
    select(tab);
    setOpen(false);
    if (focus) requestAnimationFrame(() => (document.getElementById("lc-tab-" + tab.replace(/ /g, "-")) ?? more.current)?.focus());
  }
  function label(tab: Tab) {
    const Icon = icons[tab];
    return <><Icon size={16} /><span>{tabName(tab)}</span>{locks[tab] ? <CodingLock size={14} aria-label="Locked" /> : null}</>;
  }
  function reorderKey(event: React.KeyboardEvent, tab: Tab) {
    if (mobile || !event.altKey || !["ArrowLeft", "ArrowRight"].includes(event.key)) return false;
    event.preventDefault();
    const index = panel.tabs.indexOf(tab);
    if (event.key === "ArrowLeft" && index > 0) reorder(tab, panel.tabs[index - 1]);
    if (event.key === "ArrowRight" && index < panel.tabs.length - 1) reorder(tab, panel.tabs[index + 2]);
    requestAnimationFrame(() => (document.getElementById("lc-tab-" + tab.replace(/ /g, "-")) ?? more.current)?.focus());
    return true;
  }
  return <section className="lc-dock-panel" aria-label={panelName(panel)}>
    <header className="lc-dock-head" ref={header}>
      <div className="lc-dock-measure" ref={measure} aria-hidden="true">
        {panel.tabs.map((tab) => <span key={tab} className="lc-dock-tab">{label(tab)}</span>)}
        <span className="lc-dock-tab lc-dock-more">More<ChevronDownIcon size={14} /></span>
      </div>
      <div className="lc-dock-strip" ref={strip} role="tablist" aria-label={panelName(panel) + " tabs"}
        onDragOver={(event) => {if(dragging.current) event.preventDefault();}}
        onDrop={(event) => {if(dragging.current){event.preventDefault();reorder(dragging.current);dragging.current=null;setDropBefore(null);}}}>
        {visible.map((tab) => <button key={tab} type="button" id={"lc-tab-" + tab.replace(/ /g, "-")} role="tab" aria-selected={tab === panel.active} tabIndex={tab === panel.active ? 0 : -1} aria-controls={"lc-body-" + panel.id} className={"lc-dock-tab" + (dropBefore === tab ? " lc-dock-tab--drop" : "")} title={locks[tab] ?? (mobile ? undefined : "Drag to reorder in this pane. Alt + arrow keys to reorder.")} draggable={!mobile}
          onDragStart={(event) => {dragging.current=tab;event.dataTransfer.setData("application/x-nosey-pane-tab",panel.id + ":" + tab);event.dataTransfer.effectAllowed="move";}}
          onDragEnd={() => {dragging.current=null;setDropBefore(null);}}
          onDragOver={(event) => {if(dragging.current && dragging.current !== tab){event.preventDefault();event.stopPropagation();setDropBefore(tab);}}}
          onDrop={(event) => {if(dragging.current){event.preventDefault();event.stopPropagation();reorder(dragging.current,tab);dragging.current=null;setDropBefore(null);}}}
          onClick={() => choose(tab)} onKeyDown={(event) => {
          if (reorderKey(event,tab)) return;
          const index = panel.tabs.indexOf(tab);
          const offsets: Record<string, number> = {ArrowRight:index + 1, ArrowLeft:index - 1, Home:0, End:panel.tabs.length - 1};
          if (event.key in offsets) {
            event.preventDefault();
            choose(panel.tabs[(offsets[event.key] + panel.tabs.length) % panel.tabs.length], true);
          }
        }}>{label(tab)}</button>)}
        {hidden.length ? <button ref={more} type="button" className={"lc-dock-tab lc-dock-more" + (hidden.includes(panel.active) ? " is-active" : "")} aria-haspopup="menu" aria-expanded={open} aria-label={hidden.length + " more tabs" + (hidden.includes(panel.active) ? ", " + tabName(panel.active) + " selected" : "")} title={hidden.includes(panel.active) ? tabName(panel.active) + " selected. More tabs" : "More tabs"} onKeyDown={(event) => {reorderKey(event,panel.active);}} onClick={() => setOpen(!open)}><span>{hidden.includes(panel.active) ? tabName(panel.active) : "More"}</span><ChevronDownIcon size={14} /></button> : null}
      </div>
      {open ? <DockMenu label="More tabs" className="lc-dock-pop--more" onClose={(refocus) => {setOpen(false); if (refocus) more.current?.focus();}} sections={[{items:hidden.map((tab) => {const Icon = icons[tab]; return {key:tab, label:tabName(tab), icon:<Icon size={16} />, trail:tab === panel.active ? <span aria-label="Selected">Selected</span> : locks[tab] ? <CodingLock size={14} aria-label="Locked" /> : undefined, onSelect:() => choose(tab,true)};})}]} /> : null}
    </header>
    <div key={panel.active} className="lc-dock-content" role="tabpanel" tabIndex={0} id={"lc-body-" + panel.id} aria-label={tabName(panel.active)}>
      <div className="lc-dock-mount" ref={(element) => attach(panel.active, element)} />
    </div>
  </section>;
}
export function EditorDock({
  toolbar,
  contents,
  locks,
  lockActions = {},
}: {
  toolbar: (menu: ReactNode, select: (t: Tab) => void) => ReactNode;
  contents: Contents;
  locks: Locks;
  /** An optional way out of a lock, shown under its message. */
  lockActions?: Partial<Record<Tab, ReactNode>>;
}) {
  const key = scopeKey("nosey_lc_editor_layout_v1");
  const [layout, dispatch] = useReducer(reduceLayout, key, (k) => {
    try {
      return readFixedLayout(localStorage.getItem(k));
    } catch {
      return initialLayout();
    }
  });
  const mobile = useMobileShell();
  const [phoneTab, setPhoneTab] = useState<Tab>("Description");
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(layout));
    } catch {
      /* Storage unavailable. */
    }
  }, [key, layout]);
  const all = panels(layout.root);
  const [hosts] = useState(
    () => new Map(tabs.map((t) => [t, document.createElement("div")])),
  );
  const [visited, setVisited] = useState<Set<Tab>>(() => new Set());
  const visible = mobile
    ? [phoneTab]
    : all.map((p) => p.active);
  useLayoutEffect(() => {
    if (visible.some((tab) => !visited.has(tab)))
      setVisited(new Set([...visited, ...visible]));
  }, [visible, visited]);
  function attach(tab: Tab, element: HTMLDivElement | null) {
    const host = hosts.get(tab)!;
    if (element && host.parentNode !== element) element.appendChild(host);
  }
  function send(action: Action) {
    if (mobile && action.type === "select") setPhoneTab(action.tab);
    else dispatch(action);
  }
  // Where a horizontal divider meets the vertical one beside it, a junction handle drags
  // both at once: x resizes the columns, y resizes the rows.
  function junction(inner: Node, outer: Node | undefined, side: "start" | "end"): ReactNode {
    if (inner.kind !== "split" || inner.axis !== "column" || outer?.kind !== "split" || outer.axis !== "row") return null;
    return <span className={"lc-dock-junction lc-dock-junction--" + side} aria-hidden="true"
      onPointerDown={(event) => { event.stopPropagation(); event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const rows = event.currentTarget.closest(".lc-dock-column")!.getBoundingClientRect();
        const columns = event.currentTarget.closest(".lc-dock-column")!.parentElement!.closest(".lc-dock-row")!.getBoundingClientRect();
        send({ type: "resize", id: inner.id, ratio: (event.clientY - rows.top) / rows.height });
        send({ type: "resize", id: outer.id, ratio: (event.clientX - columns.left) / columns.width });
      }} />;
  }
  function render(node: Node, parent?: Node): ReactNode {
    if (node.kind === "panel") return <DockPanel key={node.id} panel={node} locks={locks} mobile={mobile} reorder={(tab,before) => send({type:"reorder",id:node.id,tab,before})} select={(tab) => send({type:"select", tab})} attach={attach} />;
    return <div className={"lc-dock-split lc-dock-" + node.axis} key={node.id}>
      <div className="lc-dock-slot" style={{flex:node.ratio + " 1 0%"}}>{render(node.a, node)}</div>
      <div className="lc-dock-divider" role="separator" tabIndex={0} aria-label="Resize panels" aria-orientation={node.axis === "row" ? "vertical" : "horizontal"} aria-valuemin={12} aria-valuemax={88} aria-valuenow={Math.round(node.ratio * 100)}
        onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault(); }}
        onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          const rect=event.currentTarget.parentElement!.getBoundingClientRect();
          send({type:"resize",id:node.id,ratio:node.axis === "row" ? (event.clientX-rect.left)/rect.width : (event.clientY-rect.top)/rect.height});
        }}
        onKeyDown={(event) => {
          const directions=node.axis === "row" ? ["ArrowLeft","ArrowRight"] : ["ArrowUp","ArrowDown"];
          if (directions.includes(event.key)) { event.preventDefault(); send({type:"resize",id:node.id,ratio:node.ratio+(event.key === directions[0] ? -0.05 : 0.05)}); }
        }}>{parent && parent.kind === "split" ? junction(node, parent, parent.b === node ? "start" : "end") : null}</div>
      <div className="lc-dock-slot" style={{flex:(1-node.ratio) + " 1 0%"}}>{render(node.b, node)}</div>
    </div>;
  }

  return <>
    {toolbar(null, (tab) => send({type:"select", tab}))}
    <div className="lc-dock">{render(mobile ? {kind:"panel",id:"phone",tabs:phoneTabs,active:phoneTab,collapsed:false} : layout.root)}</div>
    {[...visited].map((tab) => createPortal(locks[tab] ? <div className="lc-dock-lock"><CodingLock size={22} aria-hidden="true" /><p>{locks[tab]}</p>{lockActions[tab]}</div> : contents[tab], hosts.get(tab)!, tab))}
  </>;
}
