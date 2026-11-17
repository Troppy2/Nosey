import Editor from "@monaco-editor/react";
import { TextArea } from "./Field";
import { InlineLoading } from "./Loaders";
import "../styles/components/practice-type.css";

// The typed side of a lesson practice pad: a text box for [[scratchpad:text]]
// or a code editor for [[scratchpad:code <language>]]. Lives inside the
// scratch pad modal, next to the ink tab.

// Marker language -> Monaco language id, where they differ.
const MONACO_IDS: Record<string, string> = { bash: "shell" };

const LANGUAGE_NAMES: Record<string, string> = {
  python: "Python",
  javascript: "JavaScript",
  typescript: "TypeScript",
  java: "Java",
  cpp: "C++",
  c: "C",
  csharp: "C#",
  go: "Go",
  rust: "Rust",
  kotlin: "Kotlin",
  swift: "Swift",
  ruby: "Ruby",
  php: "PHP",
  sql: "SQL",
  bash: "Bash",
};

export function languageName(language: string | null): string {
  return language ? (LANGUAGE_NAMES[language] ?? language) : "Code";
}

type PracticeTypePanelProps = {
  mode: "text" | "code";
  language: string | null;
  value: string;
  onChange: (value: string) => void;
};

export function PracticeTypePanel({ mode, language, value, onChange }: PracticeTypePanelProps) {
  if (mode === "text") {
    return (
      <div className="scratchpad-type-panel">
        <TextArea
          label="Your answer"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Write your answer in your own words."
          autoFocus
        />
      </div>
    );
  }
  const lang = language ?? "python";
  return (
    <div className="scratchpad-type-panel is-code">
      <span className="field-label">Your {languageName(lang)} code</span>
      <div className="scratchpad-type-editor">
        {/* Absolute fill: gives the editor a definite height to take 100% of. */}
        <div className="scratchpad-type-editor-fill">
        <Editor
          height="100%"
          language={MONACO_IDS[lang] ?? lang}
          value={value}
          onChange={(next) => onChange(next ?? "")}
          theme="vs"
          loading={<InlineLoading label="Opening the editor" />}
          options={{
            fontSize: 14,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            lineNumbers: "on",
            wordWrap: "on",
            automaticLayout: true,
            tabSize: 4,
            padding: { top: 8 },
          }}
        />
        </div>
      </div>
    </div>
  );
}
