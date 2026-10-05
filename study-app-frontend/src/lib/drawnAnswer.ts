// A drawn answer is stored as the lines of its transcript that are the
// student's own working (GH #157), so it is a subset of the transcript rather
// than equal to it. Paragraphs are split on blank lines, as the backend
// normalizes them.
function paragraphs(text: string): string[] {
  return text.trim().split(/\n\s*\n/).map((line) => line.trim()).filter(Boolean);
}

export function isReadFromDrawing(answer: string, transcript: string | null | undefined): boolean {
  if (!transcript?.trim() || !answer.trim()) return false;
  const known = new Set(paragraphs(transcript));
  return paragraphs(answer).every((line) => known.has(line));
}
