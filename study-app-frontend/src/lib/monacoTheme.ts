import type { Monaco } from "@monaco-editor/react";

export const NOSEY_EDITOR_THEME = "nosey-light";

/** Monaco needs hex colours, so the theme reads Nosey's tokens from base.css at
    mount instead of copying them: the code editor follows the palette. */
export function defineNoseyTheme(monaco: Monaco) {
  const css = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) => {
    const value = css.getPropertyValue(name).trim();
    return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
  };
  const white = token("--white", "#ffffff");
  const ink = token("--ink", "#26301f");
  const muted = token("--muted", "#596949");
  const lightest = token("--green-lightest", "#e9f5db");
  const light = token("--green-light", "#cfe1b9");
  const mid = token("--green-mid", "#97a97c");
  const dark = token("--green-dark", "#718355");
  const keyword = token("--accent-positive-strong", "#2f5e35");
  const string = token("--accent-caution-strong", "#6f4810");
  const number = token("--accent-info-strong", "#2d4f5f");
  const bare = (hex: string) => hex.slice(1);
  monaco.editor.defineTheme(NOSEY_EDITOR_THEME, {
    base: "vs",
    inherit: true,
    rules: [
      { token: "", foreground: bare(ink) },
      { token: "keyword", foreground: bare(keyword), fontStyle: "bold" },
      { token: "string", foreground: bare(string) },
      { token: "number", foreground: bare(number) },
      { token: "comment", foreground: bare(muted), fontStyle: "italic" },
      { token: "delimiter", foreground: bare(muted) },
      { token: "type", foreground: bare(number) },
    ],
    colors: {
      "editor.background": white,
      "editor.foreground": ink,
      "editorGutter.background": white,
      "editor.lineHighlightBackground": lightest + "99",
      "editor.lineHighlightBorder": lightest + "00",
      "editorLineNumber.foreground": mid,
      "editorLineNumber.activeForeground": ink,
      "editorCursor.foreground": dark,
      "editor.selectionBackground": light + "b3",
      "editor.inactiveSelectionBackground": light + "66",
      "editor.wordHighlightBackground": lightest,
      "editorIndentGuide.background1": lightest,
      "editorIndentGuide.activeBackground1": mid,
      "editorBracketMatch.background": lightest,
      "editorBracketMatch.border": mid,
      "editorBracketHighlight.foreground1": ink,
      "editorBracketHighlight.foreground2": keyword,
      "editorBracketHighlight.foreground3": string,
      "editorOverviewRuler.border": white + "00",
      "scrollbar.shadow": white + "00",
      "editorWidget.background": white,
      "editorWidget.border": light,
      "editorSuggestWidget.selectedBackground": lightest,
      "scrollbarSlider.background": mid + "40",
      "scrollbarSlider.hoverBackground": mid + "80",
      "scrollbarSlider.activeBackground": dark + "80",
    },
  });
}

export const LEETCODE_EDITOR_THEME = "nosey-leetcode";

/** LeetCode's dark editor: a soft gray instead of black, with its familiar syntax colours. */
function defineLeetCodeTheme(monaco: Monaco) {
  monaco.editor.defineTheme(LEETCODE_EDITOR_THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "", foreground: "d4d4d4" },
      { token: "keyword", foreground: "569cd6" },
      { token: "string", foreground: "ce9178" },
      { token: "number", foreground: "b5cea8" },
      { token: "comment", foreground: "6a9955", fontStyle: "italic" },
      { token: "type", foreground: "4ec9b0" },
      { token: "delimiter", foreground: "d4d4d4" },
    ],
    colors: {
      "editor.background": "#262626",
      "editorGutter.background": "#262626",
      "editor.foreground": "#d4d4d4",
      "editor.lineHighlightBackground": "#2f2f2f",
      "editor.lineHighlightBorder": "#2f2f2f00",
      "editorLineNumber.foreground": "#858585",
      "editorLineNumber.activeForeground": "#c6c6c6",
      "editorCursor.foreground": "#aeafad",
      "editor.selectionBackground": "#264f78",
      "editorIndentGuide.background1": "#404040",
      "editorIndentGuide.activeBackground1": "#707070",
      "editorOverviewRuler.border": "#26262600",
      "scrollbar.shadow": "#00000000",
    },
  });
}

/** Every editor colour the setting offers, by stored value. Black is Monaco's own dark theme. */
export type EditorColor = "black" | "leetcode" | "light";
export const EDITOR_COLORS: { value: EditorColor; label: string; theme: string }[] = [
  { value: "black", label: "Black", theme: "vs-dark" },
  { value: "leetcode", label: "LeetCode", theme: LEETCODE_EDITOR_THEME },
  { value: "light", label: "Light", theme: NOSEY_EDITOR_THEME },
];
export const editorThemeFor = (color: EditorColor) =>
  EDITOR_COLORS.find((item) => item.value === color)?.theme ?? "vs-dark";

export function defineEditorThemes(monaco: Monaco) {
  defineNoseyTheme(monaco);
  defineLeetCodeTheme(monaco);
}
