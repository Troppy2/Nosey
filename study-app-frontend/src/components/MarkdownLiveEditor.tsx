import { useEffect, useRef } from "react";
import katex from "katex";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { EditorState, type Extension, Prec, type Range, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  placeholder as placeholderExt,
  showTooltip,
  type Tooltip,
  tooltips,
  WidgetType,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";

import { CALLOUT_HEAD_RE, calloutTone, findInlineMath, LIVE_MARKDOWN_EXTENSIONS } from "../lib/markdownLiveSyntax";
import { type FormatKind, formatSelection } from "../lib/markdownFormat";
import { safeHttpUrl } from "./MarkdownContent";

// Obsidian-style Live Preview for a written answer. The text never leaves the
// editor and is always styled (headings big, ==highlights== tinted, quotes and
// callouts framed, code lines shaded). Only the markup characters (#, **, ==, >,
// [!tip], link URLs) hide, and they show again on the line the cursor is on, so
// moving around never swaps a block for a different-looking copy. Tasks become
// clickable checkboxes and $math$ renders with KaTeX (trust off) when the cursor
// is elsewhere. Nothing a student types is ever turned into HTML: all text stays
// CodeMirror text, and the only HTML produced is KaTeX's.

export const setFocused = StateEffect.define<boolean>();

export const focusedField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setFocused)) return effect.value;
    return value;
  },
});

// ── Widgets ──────────────────────────────────────────────────────────────────

class MathWidget extends WidgetType {
  constructor(readonly src: string, readonly display: boolean) {
    super();
  }
  eq(other: MathWidget) {
    return other.src === this.src && other.display === this.display;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = this.display ? "md-live-math md-live-math--display" : "md-live-math";
    el.innerHTML = katex.renderToString(this.src, { displayMode: this.display, throwOnError: false, output: "html" });
    return el;
  }
  ignoreEvent() {
    return false;
  }
}

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean, readonly pos: number) {
    super();
  }
  eq(other: CheckboxWidget) {
    return other.checked === this.checked && other.pos === this.pos;
  }
  toDOM(view: EditorView) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "checkbox-input md-live-task";
    box.checked = this.checked;
    box.setAttribute("aria-label", this.checked ? "Done" : "Not done");
    box.addEventListener("mousedown", (event) => event.preventDefault());
    box.addEventListener("click", (event) => {
      event.preventDefault();
      // "[ ]" <-> "[x]": the character after the bracket.
      view.dispatch({ changes: { from: this.pos + 1, to: this.pos + 2, insert: this.checked ? " " : "x" } });
    });
    return box;
  }
  ignoreEvent() {
    return true;
  }
}

class BulletWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "md-live-bullet";
    el.textContent = "•";
    return el;
  }
}

class CalloutLabelWidget extends WidgetType {
  constructor(readonly label: string) {
    super();
  }
  eq(other: CalloutLabelWidget) {
    return other.label === this.label;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "md-live-callout-label";
    el.textContent = this.label;
    return el;
  }
}

const hide = Decoration.replace({});
const bullet = Decoration.replace({ widget: new BulletWidget() });
const mark = (cls: string) => Decoration.mark({ class: cls });
const line = (cls: string) => Decoration.line({ class: cls });

// ── Decorations ──────────────────────────────────────────────────────────────

function activeLines(state: EditorState): Set<number> {
  const lines = new Set<number>();
  if (!state.field(focusedField)) return lines;
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;
    for (let n = first; n <= last; n++) lines.add(n);
  }
  return lines;
}

export function buildLiveDecorations(state: EditorState): DecorationSet {
  const doc = state.doc;
  const active = activeLines(state);
  const isActive = (pos: number) => active.has(doc.lineAt(pos).number);
  const decos: Range<Decoration>[] = [];
  const noMath: [number, number][] = []; // code spans and fences: $ is literal there

  // Hides a marker and the single space that follows it ("## ", "> ").
  const hideMarker = (from: number, to: number) => {
    const end = doc.sliceString(to, to + 1) === " " ? to + 1 : to;
    if (end > from) decos.push(hide.range(from, end));
  };

  syntaxTree(state).iterate({
    enter(node) {
      const { name, from, to } = node;

      if (/^ATXHeading[1-6]$/.test(name)) {
        decos.push(line(`md-live-h md-live-h${name.slice(-1)}`).range(doc.lineAt(from).from));
        return;
      }
      if (name === "HeaderMark") {
        if (node.node.parent?.name.startsWith("ATXHeading") && !isActive(from)) hideMarker(from, to);
        return;
      }
      if (name === "EmphasisMark" || name === "StrikethroughMark" || name === "HighlightMark") {
        if (!isActive(from)) decos.push(hide.range(from, to));
        return;
      }
      if (name === "Highlight") {
        decos.push(mark("md-live-highlight").range(from, to));
        return;
      }
      if (name === "InlineCode") {
        noMath.push([from, to]);
        decos.push(mark("md-live-inline-code").range(from, to));
        return;
      }
      if (name === "CodeMark" && node.node.parent?.name === "InlineCode") {
        if (!isActive(from)) decos.push(hide.range(from, to));
        return;
      }
      if (name === "FencedCode") {
        noMath.push([from, to]);
        const first = doc.lineAt(from).number;
        const last = doc.lineAt(to).number;
        for (let n = first; n <= last; n++) {
          const edge = n === first ? " md-live-code--first" : n === last ? " md-live-code--last" : "";
          const fence = n === first || n === last ? " md-live-code--fence" : "";
          decos.push(line(`md-live-code${edge}${fence}`).range(doc.line(n).from));
        }
        return false;
      }
      if (name === "Link") {
        const url = node.node.getChild("URL");
        // "[!tip]" and other bracket text without a URL are not links.
        if (!url) return;
        const href = safeHttpUrl(doc.sliceString(url.from, url.to));
        const marks = node.node.getChildren("LinkMark");
        if (marks.length >= 2) {
          decos.push(mark(href ? "md-live-link" : "md-live-link md-live-link--blocked").range(marks[0].to, marks[1].from));
          if (!isActive(from)) {
            decos.push(hide.range(marks[0].from, marks[0].to));
            decos.push(hide.range(marks[1].from, to));
          }
        }
        return false;
      }
      if (name === "Blockquote") {
        const firstLine = doc.lineAt(from);
        const afterMark = firstLine.text.replace(/^\s{0,3}>\s?/, "");
        const head = afterMark.match(CALLOUT_HEAD_RE);
        const lastNumber = doc.lineAt(to).number;
        const tone = head ? ` md-live-callout md-live-callout--${calloutTone(head[1])}` : "";
        for (let n = firstLine.number; n <= lastNumber; n++) {
          const edge = n === firstLine.number ? " md-live-quote--first" : "";
          const end = n === lastNumber ? " md-live-quote--last" : "";
          decos.push(line(`md-live-quote${tone}${edge}${end}`).range(doc.line(n).from));
        }
        if (head && !active.has(firstLine.number)) {
          const headFrom = firstLine.from + (firstLine.text.length - afterMark.length);
          const headTo = headFrom + head[0].length;
          const rest = firstLine.text.slice(headTo - firstLine.from).trim();
          const label = rest ? "" : head[1].charAt(0).toUpperCase() + head[1].slice(1);
          decos.push(
            label
              ? Decoration.replace({ widget: new CalloutLabelWidget(label) }).range(headFrom, headTo)
              : hide.range(headFrom, headTo),
          );
        }
        if (head) decos.push(line("md-live-callout-title").range(firstLine.from));
        return;
      }
      if (name === "QuoteMark") {
        if (!isActive(from)) hideMarker(from, to);
        return;
      }
      if (name === "TaskMarker") {
        const checked = /x/i.test(doc.sliceString(from, to));
        if (!isActive(from)) decos.push(Decoration.replace({ widget: new CheckboxWidget(checked, from) }).range(from, to));
        if (checked) {
          const lineEnd = doc.lineAt(from).to;
          if (lineEnd > to) decos.push(mark("md-live-task-done").range(to, lineEnd));
        }
        return;
      }
      if (name === "ListMark") {
        if (isActive(from)) return;
        const item = node.node.parent;
        const isTask = !!item?.getChild("Task");
        const inBulletList = item?.parent?.name === "BulletList";
        if (isTask) hideMarker(from, to);
        else if (inBulletList) decos.push(bullet.range(from, to));
        return;
      }
      if (name === "HorizontalRule") {
        decos.push(line("md-live-hr").range(doc.lineAt(from).from));
        return;
      }
      return;
    },
  });

  // %%comments%% stay visible but read as notes to self.
  const text = doc.toString();
  for (const m of text.matchAll(/%%[\s\S]*?%%/g)) {
    const from = m.index ?? 0;
    if (!noMath.some(([a, b]) => from >= a && from < b)) decos.push(mark("md-live-comment").range(from, from + m[0].length));
  }

  // Math on lines the cursor is not on. Multi-line $$ blocks stay raw text.
  for (let n = 1; n <= doc.lines; n++) {
    if (active.has(n)) continue;
    const l = doc.line(n);
    for (const span of findInlineMath(l.text, l.from)) {
      if (noMath.some(([a, b]) => span.from < b && span.to > a)) continue;
      decos.push(Decoration.replace({ widget: new MathWidget(span.src, span.display) }).range(span.from, span.to));
    }
  }

  return Decoration.set(decos, true);
}

export const livePreviewField = StateField.define<DecorationSet>({
  create: buildLiveDecorations,
  update(decorations, tr) {
    const focusChanged = tr.effects.some((effect) => effect.is(setFocused));
    const treeChanged = syntaxTree(tr.state) !== syntaxTree(tr.startState);
    if (tr.docChanged || tr.selection || focusChanged || treeChanged) return buildLiveDecorations(tr.state);
    return decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});

// ── Formatting: shortcuts and a toolbar over a selection ─────────────────────

function runFormat(view: EditorView, kind: FormatKind): boolean {
  view.dispatch(formatSelection(view.state, kind), { scrollIntoView: true, userEvent: "input.format" });
  view.focus();
  return true;
}

const formatKeymap = Prec.high(
  keymap.of([
    { key: "Mod-b", run: (view) => runFormat(view, "bold") },
    { key: "Mod-i", run: (view) => runFormat(view, "italic") },
    { key: "Mod-Shift-h", run: (view) => runFormat(view, "highlight") },
    { key: "Mod-Shift-x", run: (view) => runFormat(view, "strike") },
    { key: "Mod-e", run: (view) => runFormat(view, "code") },
    { key: "Mod-m", run: (view) => runFormat(view, "math") },
  ]),
);

// Text glyphs, not icons: each shows the formatting it applies.
const FORMAT_BUTTONS: { kind: FormatKind; label: string; title: string; html: string }[] = [
  { kind: "bold", label: "Bold", title: "Bold (Ctrl+B)", html: "<strong>B</strong>" },
  { kind: "italic", label: "Italic", title: "Italic (Ctrl+I)", html: "<em>I</em>" },
  { kind: "highlight", label: "Highlight", title: "Highlight (Ctrl+Shift+H)", html: '<mark class="md-highlight">H</mark>' },
  { kind: "strike", label: "Strikethrough", title: "Strikethrough (Ctrl+Shift+X)", html: "<s>S</s>" },
  { kind: "code", label: "Code", title: "Code, a block for several lines (Ctrl+E)", html: "<code>&lt;/&gt;</code>" },
  { kind: "math", label: "Math", title: "Math, a $$ block for several lines (Ctrl+M)", html: "<span>$x$</span>" },
];

function formatToolbar(state: EditorState): readonly Tooltip[] {
  const main = state.selection.main;
  if (!state.field(focusedField) || main.empty) return [];
  return [
    {
      pos: main.from,
      above: true,
      arrow: false,
      create: (view) => {
        const dom = document.createElement("div");
        dom.className = "md-format-bar";
        dom.setAttribute("role", "toolbar");
        dom.setAttribute("aria-label", "Format selection");
        for (const button of FORMAT_BUTTONS) {
          const el = document.createElement("button");
          el.type = "button";
          el.className = `md-format-btn md-format-btn--${button.kind}`;
          el.title = button.title;
          el.setAttribute("aria-label", button.label);
          el.innerHTML = button.html;
          // Keep the editor selection: act on mousedown, never take focus.
          el.addEventListener("mousedown", (event) => {
            event.preventDefault();
            runFormat(view, button.kind);
          });
          dom.appendChild(el);
        }
        return { dom };
      },
    },
  ];
}

const formatToolbarField = StateField.define<readonly Tooltip[]>({
  create: formatToolbar,
  update(value, tr) {
    const focusChanged = tr.effects.some((effect) => effect.is(setFocused));
    if (tr.docChanged || tr.selection || focusChanged) return formatToolbar(tr.state);
    return value;
  },
  provide: (field) => showTooltip.computeN([field], (state) => state.field(field)),
});

// Weight and slant come from the syntax tree, so they never change as the cursor
// moves; markers are dimmed for the line where they show.
const liveHighlight = HighlightStyle.define([
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through", color: "var(--muted)" },
  { tag: tags.monospace, fontFamily: "var(--font-mono)" },
  { tag: [tags.processingInstruction, tags.meta, tags.contentSeparator, tags.url], color: "var(--green-mid)" },
]);

export const liveMarkdownExtensions: Extension[] = [
  markdown({ extensions: LIVE_MARKDOWN_EXTENSIONS }),
  syntaxHighlighting(liveHighlight),
  focusedField,
  livePreviewField,
];

type Props = {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  autoFocus?: boolean;
  /** Receives the editor view, for a host toolbar that formats the document. */
  viewRef?: { current: EditorView | null };
};

export default function MarkdownLiveEditor({ value, onChange, label, placeholder, autoFocus, viewRef: hostViewRef }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!hostRef.current) return;
    const extensions: Extension[] = [
      history(),
      formatKeymap,
      keymap.of([...defaultKeymap, ...historyKeymap]),
      // The toolbar lives on <body> so a modal's overflow cannot clip it.
      tooltips({ parent: document.body }),
      formatToolbarField,
      ...liveMarkdownExtensions,
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ "aria-label": label, "aria-multiline": "true" }),
      EditorView.focusChangeEffect.of((_state, focusing) => setFocused.of(focusing)),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChangeRef.current(update.state.doc.toString());
      }),
    ];
    if (placeholder) extensions.push(placeholderExt(placeholder));
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({ doc: value, extensions }),
    });
    viewRef.current = view;
    if (hostViewRef) hostViewRef.current = view;
    if (autoFocus) view.focus();
    return () => {
      view.destroy();
      viewRef.current = null;
      if (hostViewRef) hostViewRef.current = null;
    };
    // The editor is created once; later value changes are synced below.
  }, []);

  // A value set from outside (draft restore) replaces the document; the editor's
  // own edits already match and are skipped.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value]);

  return <div ref={hostRef} className="md-live" />;
}
