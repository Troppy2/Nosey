import { useEffect, useState } from "react";

type Position = { lineNumber: number; column: number };
export type CursorSource = {
  getPosition(): Position | null;
  onDidChangeCursorPosition(listener: (event: { position: Position }) => void): { dispose(): void };
};

/** The code editor's footer, as in LeetCode: language left, cursor position right.
    It subscribes to the cursor itself so moving the caret never re-renders the page. */
export function EditorStatusBar({ editor, language }: { editor: CursorSource | null; language: string }) {
  const [position, setPosition] = useState<Position>({ lineNumber: 1, column: 1 });
  useEffect(() => {
    if (!editor) return;
    const start = editor.getPosition();
    if (start) setPosition(start);
    const subscription = editor.onDidChangeCursorPosition((event) => setPosition(event.position));
    return () => subscription.dispose();
  }, [editor]);
  return (
    <div className="lc-code-status">
      <span>{language}</span>
      <span className="lc-code-status-pos">Ln {position.lineNumber}, Col {position.column}</span>
    </div>
  );
}
