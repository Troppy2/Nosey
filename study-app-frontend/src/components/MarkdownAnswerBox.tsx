import { lazy, Suspense } from "react";

import { TextArea } from "./Field";
import "../styles/components/markdown-answer.css";

// CodeMirror + the static renderer only load for people who turned the setting on.
const MarkdownLiveEditor = lazy(() => import("./MarkdownLiveEditor"));

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  id?: string;
};

// A written answer with Obsidian-style Live Preview: the block you are typing in
// stays raw markdown, every other block is shown formatted, and everything is
// formatted once you click away. Used only when Settings > Markdown answers is
// on. While the editor loads, the plain text box stands in with the same value.
export function MarkdownAnswerBox({ label, value, onChange, placeholder, autoFocus, id }: Props) {
  return (
    <Suspense
      fallback={
        <TextArea
          label={label}
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
        />
      }
    >
      <div className="field md-answer-field">
        <span className="field-label">{label}</span>
        <MarkdownLiveEditor
          value={value}
          onChange={onChange}
          label={label}
          placeholder={placeholder}
          autoFocus={autoFocus}
        />
      </div>
    </Suspense>
  );
}
