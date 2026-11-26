export const tabs = [
  "Description",
  "Solutions",
  "Kojo",
  "Notes",
  "Submissions",
  "Code",
  "Testcase",
  "Test result",
  "Complexity",
] as const;
export type Tab = (typeof tabs)[number];
export type Edge = "center" | "left" | "right" | "top" | "bottom";
export type Panel = {
  kind: "panel";
  id: string;
  tabs: Tab[];
  active: Tab;
  collapsed: boolean;
};
export type Split = {
  kind: "split";
  id: string;
  axis: "row" | "column";
  ratio: number;
  a: Node;
  b: Node;
};
export type Node = Panel | Split;
export type Layout = { root: Node; max: string | null };
export function panel(id: string, items: Tab[]): Panel {
  return { kind: "panel", id, tabs: items, active: items[0], collapsed: false };
}
export function initialLayout(): Layout {
  return {
    max: null,
    root: {
      kind: "split",
      id: "columns",
      axis: "row",
      ratio: 0.42,
      a: panel("left", tabs.slice(0, 5)),
      b: {
        kind: "split",
        id: "rows",
        axis: "column",
        ratio: 0.66,
        a: panel("code", ["Code"]),
        b: panel("bottom", ["Testcase", "Test result", "Complexity"]),
      },
    },
  };
}
export function panels(node: Node): Panel[] {
  return node.kind === "panel"
    ? [node]
    : [...panels(node.a), ...panels(node.b)];
}
function transform(node: Node, fn: (node: Node) => Node | null): Node | null {
  if (node.kind === "panel") return fn(node);
  const a = transform(node.a, fn);
  const b = transform(node.b, fn);
  return a && b ? fn({ ...node, a, b }) : (a ?? b);
}
export type Action =
  | { type: "reset" }
  | { type: "select"; tab: Tab }
  | { type: "max" | "collapse"; id: string }
  | { type: "resize"; id: string; ratio: number }
  | { type: "move"; tab: Tab; to: string; edge: Edge; before?: Tab };
export function reduceLayout(state: Layout, action: Action): Layout {
  if (action.type === "reset") return initialLayout();
  if (action.type === "max") {
    if (state.max === action.id) return { ...state, max: null };
    const target = panels(state.root).find((panel) => panel.id === action.id);
    if (!target) return state;
    const expanded = target.collapsed
      ? reduceLayout(state, { type: "select", tab: target.active })
      : state;
    return { ...expanded, max: target.id };
  }
  if (action.type === "move") {
    const group = panels(state.root);
    const source = group.find((p) => p.tabs.includes(action.tab));
    const target = group.find((p) => p.id === action.to);
    if (
      !source ||
      !target ||
      (source === target &&
        (action.before === action.tab || source.tabs.length === 1))
    )
      return state;
    let serial = 0;
    while (group.some((p) => p.id === "panel-" + serial)) serial++;
    const root = transform(state.root, (n) => {
      if (n.kind !== "panel") return n;
      const items = n.tabs.filter((t) => t !== action.tab);
      const existing = {
        ...n,
        tabs: items,
        active: items.includes(n.active) ? n.active : items[0],
      };
      if (n.id !== target.id) return items.length ? existing : null;
      if (action.edge === "center") {
        const index = action.before ? items.indexOf(action.before) : -1;
        items.splice(index < 0 ? items.length : index, 0, action.tab);
        return { ...existing, active: action.tab, collapsed: false };
      }
      const fresh = panel("panel-" + serial, [action.tab]);
      const first = action.edge === "top" || action.edge === "left";
      const ids = (node: Node): string[] =>
        node.kind === "panel"
          ? [node.id]
          : [node.id, ...ids(node.a), ...ids(node.b)];
      const used = ids(state.root);
      let splitId = "split-" + serial;
      while (used.includes(splitId)) splitId += "s";
      return {
        kind: "split",
        id: splitId,
        axis: ["left", "right"].includes(action.edge) ? "row" : "column",
        ratio: 0.5,
        a: first ? fresh : existing,
        b: first ? existing : fresh,
      };
    });
    return root ? { root, max: null } : state;
  }
  let max = state.max;
  // Folding one panel of a column unfolds the other, so a column never ends up as
  // two bare tab strips with nothing open.
  let sibling: string | null = null;
  if (action.type === "collapse") {
    const find = (node: Node): void => {
      if (node.kind !== "split") return;
      const [a, b] = [node.a, node.b];
      if (a.kind === "panel" && a.id === action.id && b.kind === "panel") sibling = b.id;
      if (b.kind === "panel" && b.id === action.id && a.kind === "panel") sibling = a.id;
      find(a);
      find(b);
    };
    find(state.root);
    // Only when folding; unfolding a panel leaves its neighbor as it is.
    if (panels(state.root).find((p) => p.id === action.id)?.collapsed) sibling = null;
  }
  const root = transform(state.root, (n) => {
    if (action.type === "collapse" && n.kind === "panel" && n.id === sibling && n.collapsed)
      return { ...n, collapsed: false };
    if (
      action.type === "select" &&
      n.kind === "panel" &&
      n.tabs.includes(action.tab)
    ) {
      if (max && max !== n.id) max = null;
      return { ...n, active: action.tab, collapsed: false };
    }
    if (action.type === "resize" && n.kind === "split" && n.id === action.id)
      return { ...n, ratio: Math.min(0.88, Math.max(0.12, action.ratio)) };
    if (action.type === "collapse" && n.kind === "panel" && n.id === action.id)
      return { ...n, collapsed: !n.collapsed };
    return n;
  });
  return root ? { root, max } : state;
}
export function readLayout(raw: string | null): Layout {
  try {
    const layout = JSON.parse(raw ?? "null") as Layout;
    const ids = new Set<string>();
    const seen = new Set<Tab>();
    function valid(n: Node): boolean {
      if (
        !n ||
        typeof n.id !== "string" ||
        ids.has(n.id) ||
        ids.size > tabs.length * 2
      )
        return false;
      ids.add(n.id);
      if (n.kind === "split")
        return (
          ["row", "column"].includes(n.axis) &&
          n.ratio >= 0.12 &&
          n.ratio <= 0.88 &&
          typeof n.ratio === "number" &&
          valid(n.a) &&
          valid(n.b)
        );
      if (
        n.kind !== "panel" ||
        typeof n.collapsed !== "boolean" ||
        !Array.isArray(n.tabs) ||
        !n.tabs.includes(n.active)
      )
        return false;
      return n.tabs.every((t) => {
        if (!tabs.includes(t) || seen.has(t)) return false;
        seen.add(t);
        return true;
      });
    }
    if (
      layout &&
      valid(layout.root) &&
      seen.size === tabs.length &&
      (layout.max === null ||
        panels(layout.root).some((p) => p.id === layout.max))
    )
      return layout;
  } catch {
    /* Old or damaged preference. */
  }
  return initialLayout();
}
