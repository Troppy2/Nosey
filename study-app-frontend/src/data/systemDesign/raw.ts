/**
 * Vite's `?raw` hands back the file exactly as it sits on disk, and a Windows
 * checkout (or any git config that normalizes line endings) can carry CRLF. Every
 * authored source goes through here so the bundled content is byte-identical
 * whatever machine built it: a textarea, the Pyodide virtual filesystem and a
 * test all see the same string.
 */
export function normalizeSource(source: string): string {
  return source.replace(/\r\n/g, "\n");
}
