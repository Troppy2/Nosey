import { createPortal } from "react-dom";
import {
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
} from "react";
import { CodingLock } from "./Tab";
import { Button } from "./Button";
import {
  DescriptionIcon,
  SolutionsIcon,
  ChatIcon,
  NotebookIcon,
  HistoryIcon,
  CodeIcon,
  TestcaseIcon,
  TerminalIcon,
  ComplexityIcon,
  MaximizeIcon,
  RestoreIcon,
  LayoutIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  GripIcon,
  UndoIcon,
} from "../icons";
import { scopeKey } from "../lib/api";
import { useMobileShell } from "../lib/useMobileShell";
import {
  initialLayout,
  panels,
  readLayout,
  reduceLayout,
  tabs,
  type Action,
  type Edge,
  type Node,
  type Panel,
  type Tab,
} from "../lib/editorLayout";
import "../styles/components/editor-dock.css";

const icons = {
  Description: DescriptionIcon,
  Solutions: SolutionsIcon,
  Kojo: ChatIcon,
  Notes: NotebookIcon,
  Submissions: HistoryIcon,
  Code: CodeIcon,
  Testcase: TestcaseIcon,
  "Test result": TerminalIcon,
  Complexity: ComplexityIcon,
};
/** A panel is named after its first tab ("Code panel"): panels can be split and
    rearranged, so a fixed name like "Right top" stops being true. */
function panelName(p: Panel) {
  return p.tabs[0] + " panel";
}
/** Phone shows one panel; the statement and the code come first so the two tabs
    used most never fall into More. */
const phoneTabs: Tab[] = [
  "Description",
  "Code",
  "Testcase",
  "Test result",
  "Solutions",
  "Kojo",
  "Notes",
  "Submissions",
  "Complexity",
];
const edges: Edge[] = ["top", "bottom", "left", "right"];
const edgeNames: Record<Edge, string> = {
  center: "Center",
  top: "Top",
  bottom: "Bottom",
  left: "Left",
  right: "Right",
};
type MenuItem = {
  key: string;
  label: ReactNode;
  icon?: ReactNode;
  trail?: ReactNode;
  onSelect: () => void;
};
type MenuSection = { title?: string; items: MenuItem[]; row?: boolean };
/** The one popover menu the dock uses (More tabs, Move to, Layout): role="menu",
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
/** The top bar's Layout button: maximize a panel, show all, reset the layout. */
function LayoutMenu({ sections }: { sections: MenuSection[] }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useOutsideClose(open, box, () => setOpen(false));
  return (
    <div className="lc-layout-menu" ref={box}>
      <button
        ref={button}
        type="button"
        className="lc-layout-menu-button"
        aria-label="Layout"
        title="Layout"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <LayoutIcon size={18} active={open} />
      </button>
      {open && (
        <DockMenu
          label="Layout"
          sections={sections.map((s) => ({
            ...s,
            items: s.items.map((item) => ({
              ...item,
              onSelect: () => {
                item.onSelect();
                setOpen(false);
                button.current?.focus();
              },
            })),
          }))}
          onClose={(refocus) => {
            setOpen(false);
            if (refocus) button.current?.focus();
          }}
        />
      )}
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
  }, [open]);
}
function edgeAt(element: Element, clientX: number, clientY: number): Edge {
  const box = element.getBoundingClientRect();
  const x = (clientX - box.left) / box.width,
    y = (clientY - box.top) / box.height;
  const distances = [y, 1 - y, x, 1 - x];
  const min = Math.min(...distances);
  return min < 0.23 ? edges[distances.indexOf(min)] : "center";
}
type Contents = Record<Tab, ReactNode>;
type Locks = Partial<Record<Tab, string>>;
type PanelProps = {
  p: Panel;
  all: Panel[];
  send: Dispatch<Action>;
  attach: (tab: Tab, element: HTMLDivElement | null) => void;
  locks: Locks;
  mobile: boolean;
  max: boolean;
  dragging: Tab | null;
  drag: (t: Tab | null) => void;
  /** Only panels stacked in a column can fold down to their tab strip; a folded
      side-by-side panel would leave an empty column behind. */
  collapsible: boolean;
};
function DockPanel({
  p,
  all,
  send,
  attach,
  locks,
  mobile,
  max,
  dragging,
  drag,
  collapsible,
}: PanelProps) {
  const strip = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [sizes, setSizes] = useState<number[]>([]);
  const [menu, setMenu] = useState<"more" | "move" | null>(null);
  const [preview, setPreview] = useState<Edge | null>(null);
  const header = useRef<HTMLElement>(null);
  const section = useRef<HTMLElement>(null);
  useOutsideClose(Boolean(menu), header, () => setMenu(null));
  // Panel bodies are portals rendered by EditorDock, so React's drag events from
  // inside a body bubble to EditorDock, never to this section. Native capture
  // listeners on the section see them, and claim the drag before the content does
  // (Monaco or a text field would otherwise take the drop as pasted text). The tab
  // strip keeps its React handlers (drop on a tab = insert before it).
  const live = useRef({ dragging, move: (_t: Tab, _e: Edge) => {} });
  live.current = { dragging, move: (t, edge) => move(t, p.id, edge) };
  useEffect(() => {
    const el = section.current;
    if (!el) return;
    const claim = (e: DragEvent) => {
      if (!live.current.dragging || header.current?.contains(e.target as HTMLElement)) return false;
      e.preventDefault();
      e.stopPropagation();
      return true;
    };
    const over = (e: DragEvent) => {
      if (!claim(e)) return;
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      setPreview(edgeAt(el, e.clientX, e.clientY));
    };
    const drop = (e: DragEvent) => {
      const tab = live.current.dragging;
      if (!claim(e) || !tab) return;
      live.current.move(tab, edgeAt(el, e.clientX, e.clientY));
    };
    el.addEventListener("dragover", over, true);
    el.addEventListener("drop", drop, true);
    return () => {
      el.removeEventListener("dragover", over, true);
      el.removeEventListener("drop", drop, true);
    };
  }, []);
  useLayoutEffect(() => {
    if (!strip.current || !measure.current) return;
    const update = () => {
      setWidth(strip.current?.getBoundingClientRect().width ?? 0);
      setSizes(
        Array.from(measure.current?.children ?? []).map(
          (n) => n.getBoundingClientRect().width,
        ),
      );
    };
    const observer = new ResizeObserver(update);
    observer.observe(strip.current);
    observer.observe(measure.current);
    update();
    return () => observer.disconnect();
  }, [p.tabs.join(), p.active, locks[p.active]]);
  // The measure row holds every tab plus the More button (last child), so the room
  // kept for More is its real width and visible tabs never get squeezed.
  const tabSizes = sizes.slice(0, p.tabs.length);
  const moreSize = sizes[p.tabs.length] ?? 0;
  const total = tabSizes.reduce((a, b) => a + b, 0);
  const overflow = total > width + 0.5;
  // Keep tabs in order: the active tab always shows, then tabs from the start of
  // the strip until one does not fit; everything after it goes into More (never
  // skipping a wide tab to squeeze a later narrow one in, which reorders the strip).
  let budget = width - (overflow ? moreSize : 0) - 1;
  const chosen = new Set<Tab>([p.active]);
  budget -= tabSizes[p.tabs.indexOf(p.active)] ?? 0;
  for (const [i, t] of p.tabs.entries()) {
    if (t === p.active) continue;
    // Not measured yet (first paint, or no layout at all): show every tab.
    if (!width) {
      chosen.add(t);
      continue;
    }
    if ((tabSizes[i] ?? 0) > budget) break;
    chosen.add(t);
    budget -= tabSizes[i] ?? 0;
  }
  const activeIndex = p.tabs.indexOf(p.active);
  function select(t: Tab, focus = false) {
    send({ type: "select", tab: t });
    setMenu(null);
    if (focus)
      requestAnimationFrame(() =>
        document.getElementById("lc-tab-" + t.replace(/ /g, "-"))?.focus(),
      );
  }
  function move(t: Tab, to: string, edge: Edge, before?: Tab) {
    send({ type: "move", tab: t, to, edge, before });
    drag(null);
    setMenu(null);
    setPreview(null);
    requestAnimationFrame(() =>
      document.getElementById("lc-tab-" + t.replace(/ /g, "-"))?.focus(),
    );
  }
  function label(t: Tab) {
    const Icon = icons[t];
    return (
      <>
        <Icon size={16} active={p.active === t} />
        <span>{t}</span>
        {locks[t] && <CodingLock size={14} aria-label="Locked" />}
      </>
    );
  }
  const hidden = p.tabs.filter((t) => !chosen.has(t));
  const others = all.filter((g) => g.id !== p.id);
  const moveSections: MenuSection[] = [
    {
      title: "Order",
      items: [
        ...(activeIndex > 0
          ? [{ key: "earlier", label: "Move tab left", onSelect: () => move(p.active, p.id, "center", p.tabs[activeIndex - 1]) }]
          : []),
        ...(activeIndex < p.tabs.length - 1
          ? [{ key: "later", label: "Move tab right", onSelect: () => move(p.active, p.id, "center", p.tabs[activeIndex + 2]) }]
          : []),
      ],
    },
    {
      title: "Move to",
      items: others.map((g) => {
        const Icon = icons[g.tabs[0]];
        return {
          key: g.id,
          icon: <Icon size={16} />,
          label: panelName(g),
          onSelect: () => move(p.active, g.id, "center"),
        };
      }),
    },
    {
      title: "Split this panel",
      row: true,
      items:
        p.tabs.length > 1
          ? edges.map((edge) => ({
              key: edge,
              label: edgeNames[edge],
              onSelect: () => move(p.active, p.id, edge),
            }))
          : [],
    },
  ];
  return (
    <section
      className="lc-dock-panel"
      aria-label={panelName(p)}
      ref={section}
      onDragOver={(e) => {
        if (dragging) {
          e.preventDefault();
          setPreview("center");
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as HTMLElement))
          setPreview(null);
      }}
      onDrop={(e) => {
        if (dragging) {
          e.preventDefault();
          move(dragging, p.id, "center");
        }
      }}
    >
      <header ref={header} className="lc-dock-head">
        <div className="lc-dock-measure" ref={measure} aria-hidden="true">
          {p.tabs.map((t) => (
            <span key={t} className="lc-dock-tab">
              {label(t)}
            </span>
          ))}
          <span className="lc-dock-tab lc-dock-more">
            More <ChevronDownIcon size={14} />
          </span>
        </div>
        <div
          className="lc-dock-strip"
          ref={strip}
          role="tablist"
          aria-label={panelName(p) + " tabs"}
        >
          {p.tabs
            .filter((t) => chosen.has(t))
            .map((t) => (
              <button
                key={t}
                type="button"
                id={"lc-tab-" + t.replace(/ /g, "-")}
                role="tab"
                aria-selected={t === p.active}
                tabIndex={t === p.active ? 0 : -1}
                aria-controls={"lc-body-" + t.replace(/ /g, "-")}
                title={locks[t]}
                className="lc-dock-tab"
                draggable={!mobile}
                onDragStart={(e) => {
                  // A private type, not text/plain: editors and inputs accept
                  // plain text drops and would paste the tab name.
                  e.dataTransfer.setData("application/x-nosey-tab", t);
                  e.dataTransfer.effectAllowed = "move";
                  drag(t);
                }}
                onDragEnd={() => {
                  drag(null);
                  setPreview(null);
                }}
                onDragOver={(e) => {
                  if (dragging) {
                    e.preventDefault();
                    e.stopPropagation();
                    setPreview(null);
                  }
                }}
                onDrop={(e) => {
                  if (dragging) {
                    e.preventDefault();
                    e.stopPropagation();
                    move(dragging, p.id, "center", t);
                  }
                }}
                onClick={() => select(t)}
                onKeyDown={(e) => {
                  const index = p.tabs.indexOf(t);
                  const offsets: Record<string, number> = {
                    ArrowRight: index + 1,
                    ArrowLeft: index - 1,
                    Home: 0,
                    End: p.tabs.length - 1,
                  };
                  if (e.key in offsets) {
                    e.preventDefault();
                    select(
                      p.tabs[(offsets[e.key] + p.tabs.length) % p.tabs.length],
                      true,
                    );
                  }
                  if (!mobile && e.key === "F10" && e.shiftKey) {
                    e.preventDefault();
                    setMenu("move");
                  }
                }}
              >
                {label(t)}
              </button>
            ))}
          {hidden.length > 0 && (
            <button
              type="button"
              className="lc-dock-tab lc-dock-more"
              aria-haspopup="menu"
              aria-label={`${hidden.length} more ${hidden.length === 1 ? "tab" : "tabs"}`}
              aria-expanded={menu === "more"}
              onClick={() => setMenu(menu === "more" ? null : "more")}
            >
              More <ChevronDownIcon size={14} />
            </button>
          )}
        </div>
        {!mobile && (
          <div className="lc-dock-actions">
            <Button
              variant="ghost"
              aria-label={"Move " + p.active + " to..."}
              aria-haspopup="menu"
              aria-expanded={menu === "move"}
              title={"Move " + p.active + " (or drag its tab)"}
              onClick={() => setMenu(menu === "move" ? null : "move")}
            >
              <GripIcon size={15} />
            </Button>
            {collapsible && !max && (
              <Button
                variant="ghost"
                aria-label={p.collapsed ? "Expand panel" : "Collapse panel"}
                title={p.collapsed ? "Expand" : "Collapse"}
                onClick={() => send({ type: "collapse", id: p.id })}
              >
                {p.collapsed ? <ChevronUpIcon size={15} /> : <ChevronDownIcon size={15} />}
              </Button>
            )}
            <Button
              variant="ghost"
              aria-label={max ? "Restore panel" : "Maximize panel"}
              title={max ? "Restore" : "Maximize"}
              onClick={() => send({ type: "max", id: p.id })}
            >
              {max ? <RestoreIcon size={15} /> : <MaximizeIcon size={15} />}
            </Button>
          </div>
        )}
        {menu === "more" && (
          <DockMenu
            label="More tabs"
            className="lc-dock-pop--more"
            onClose={(refocus) => {
              setMenu(null);
              if (refocus) header.current?.querySelector<HTMLElement>(".lc-dock-strip .lc-dock-more")?.focus();
            }}
            sections={[
              {
                items: hidden.map((t) => {
                  const Icon = icons[t];
                  return {
                    key: t,
                    icon: <Icon size={16} />,
                    label: t,
                    trail: locks[t] ? <CodingLock size={14} aria-label="Locked" /> : undefined,
                    onSelect: () => select(t, true),
                  };
                }),
              },
            ]}
          />
        )}
        {menu === "move" && (
          <DockMenu
            label={"Move " + p.active}
            onClose={(refocus) => {
              setMenu(null);
              if (refocus)
                document.getElementById("lc-tab-" + p.active.replace(/ /g, "-"))?.focus();
            }}
            sections={moveSections}
          />
        )}
      </header>
      {!p.collapsed && (
        <div
          key={p.active}
          className="lc-dock-content"
          role="tabpanel"
          id={"lc-body-" + p.active.replace(/ /g, "-")}
          aria-labelledby={"lc-tab-" + p.active.replace(/ /g, "-")}
        >
          <div className="lc-dock-mount" ref={(el) => attach(p.active, el)} />
        </div>
      )}
      {dragging && preview && (
        <div
          aria-hidden="true"
          className={"lc-dock-preview lc-dock-preview-" + preview}
        />
      )}
    </section>
  );
}
export function EditorDock({
  toolbar,
  contents,
  locks,
}: {
  toolbar: (menu: ReactNode, select: (t: Tab) => void) => ReactNode;
  contents: Contents;
  locks: Locks;
}) {
  const key = scopeKey("nosey_lc_editor_layout_v1");
  const [layout, dispatch] = useReducer(reduceLayout, key, (k) => {
    try {
      return readLayout(localStorage.getItem(k));
    } catch {
      return initialLayout();
    }
  });
  const mobile = useMobileShell();
  const [phoneTab, setPhoneTab] = useState<Tab>("Description");
  const [dragging, drag] = useState<Tab | null>(null);
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
    : all
        .filter((p) => !p.collapsed && (!layout.max || layout.max === p.id))
        .map((p) => p.active);
  useLayoutEffect(() => {
    if (visible.some((tab) => !visited.has(tab)))
      setVisited(new Set([...visited, ...visible]));
  }, [visible.join(), visited]);
  function attach(tab: Tab, element: HTMLDivElement | null) {
    const host = hosts.get(tab)!;
    if (element && host.parentNode !== element) element.appendChild(host);
  }
  function send(action: Action) {
    if (mobile && action.type === "select") setPhoneTab(action.tab);
    else dispatch(action);
  }
  function render(n: Node, parentAxis?: "row" | "column"): ReactNode {
    if (n.kind === "panel")
      return (
        <DockPanel
          key={n.id}
          p={n}
          all={all}
          send={send}
          attach={attach}
          locks={locks}
          mobile={mobile}
          max={layout.max === n.id}
          dragging={dragging}
          drag={drag}
          collapsible={parentAxis === "column"}
        />
      );
    const folded = (child: Node) =>
      child.kind === "panel" && child.collapsed && n.kind === "split" && n.axis === "column";
    function size(child: Node, fraction: number) {
      if (folded(child)) return "0 0 var(--lc-strip-height)";
      // The other side of a folded panel takes all the space; a grow factor under 1
      // would only claim that share of it and leave a gap.
      if (n.kind === "split" && folded(child === n.a ? n.b : n.a)) return "1 1 0%";
      return fraction + " 1 0%";
    }
    return (
      <div className={"lc-dock-split lc-dock-" + n.axis} key={n.id}>
        <div className="lc-dock-slot" style={{ flex: size(n.a, n.ratio) }}>
          {render(n.a, n.axis)}
        </div>
        <div
          className="lc-dock-divider"
          role="separator"
          tabIndex={0}
          aria-label="Resize panels"
          aria-orientation={n.axis === "row" ? "vertical" : "horizontal"}
          aria-valuenow={Math.round(n.ratio * 100)}
          onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
          onPointerMove={(e) => {
            if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
            const r = e.currentTarget.parentElement!.getBoundingClientRect();
            send({
              type: "resize",
              id: n.id,
              ratio:
                n.axis === "row"
                  ? (e.clientX - r.left) / r.width
                  : (e.clientY - r.top) / r.height,
            });
          }}
          onKeyDown={(e) => {
            const directions =
              n.axis === "row"
                ? ["ArrowLeft", "ArrowRight"]
                : ["ArrowUp", "ArrowDown"];
            if (directions.includes(e.key)) {
              e.preventDefault();
              send({
                type: "resize",
                id: n.id,
                ratio: n.ratio + (e.key === directions[0] ? -0.05 : 0.05),
              });
            }
          }}
        />
        <div className="lc-dock-slot" style={{ flex: size(n.b, 1 - n.ratio) }}>
          {render(n.b, n.axis)}
        </div>
      </div>
    );
  }
  const menu = !mobile && (
    <LayoutMenu
      sections={[
        {
          title: "Panels",
          items: layout.max
            ? [
                {
                  key: "restore",
                  icon: <RestoreIcon size={16} />,
                  label: "Show all panels",
                  onSelect: () => send({ type: "max", id: layout.max! }),
                },
              ]
            : all.map((p) => ({
                key: p.id,
                icon: <MaximizeIcon size={16} />,
                label: "Maximize " + panelName(p),
                onSelect: () => send({ type: "max", id: p.id }),
              })),
        },
        {
          items: [
            {
              key: "reset",
              icon: <UndoIcon size={16} />,
              label: "Reset layout",
              onSelect: () => send({ type: "reset" }),
            },
          ],
        },
      ]}
    />
  );
  return (
    <>
      {toolbar(menu, (t) => send({ type: "select", tab: t }))}
      <div className="lc-dock">
        {render(
          mobile
            ? {
                kind: "panel",
                id: "phone",
                tabs: phoneTabs,
                active: phoneTab,
                collapsed: false,
              }
            : (all.find((p) => p.id === layout.max) ?? layout.root),
        )}
      </div>
      {[...visited].map((t) =>
        createPortal(
          locks[t] ? (
            <div className="lc-dock-lock">
              <CodingLock size={22} aria-hidden="true" />
              {locks[t]}
            </div>
          ) : (
            contents[t]
          ),
          hosts.get(t)!,
          t,
        ),
      )}
    </>
  );
}
