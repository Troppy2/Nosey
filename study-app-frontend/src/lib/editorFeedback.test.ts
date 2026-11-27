import { expect, it } from "vitest";
import { editorRunError } from "./editorFeedback";
it("hides runner internals while retaining Python diagnoses", () => {
  expect(editorRunError('Traceback (most recent call last):\n  File "<exec>", line 198\nNameError: name x is not defined')).toBe('NameError: name x is not defined');
  expect(editorRunError('ValueError: To run, your code needs a top-level function or a class Solution.')).toContain('Add a top-level function');
  expect(editorRunError('Internal pyodide transport failed')).not.toContain('pyodide');
  expect(editorRunError()).toBeUndefined();
});
