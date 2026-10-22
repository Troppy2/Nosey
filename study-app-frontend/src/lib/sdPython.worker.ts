/// <reference lib="webworker" />
/**
 * System Design exercise runner, isolated in a dedicated Web Worker.
 *
 * SECURITY: custom topics carry hidden test modules written by an AI app through
 * the MCP connector, so they are untrusted code. On the page, Pyodide's `import js`
 * reaches window, localStorage and the user's access token. A worker has no
 * DOM, no localStorage and no cookies, and this app keeps nothing in IndexedDB,
 * so the worst a hostile module can do here is lie about its own results.
 * Never move this back onto the main thread.
 */

const PYODIDE_MODULE_URL = "https://cdn.jsdelivr.net/pyodide/v0.27.5/full/pyodide.mjs";
const PYODIDE_INDEX_URL = "https://cdn.jsdelivr.net/pyodide/v0.27.5/full/";

type Pyodide = { runPythonAsync: (code: string) => Promise<unknown> };
type RunRequest = { id: number; driver: string };

let pyodidePromise: Promise<Pyodide> | null = null;

function loadPyodide(): Promise<Pyodide> {
  if (!pyodidePromise) {
    pyodidePromise = import(/* @vite-ignore */ PYODIDE_MODULE_URL).then(
      (module: { loadPyodide: (opts: { indexURL: string }) => Promise<Pyodide> }) =>
        module.loadPyodide({ indexURL: PYODIDE_INDEX_URL }),
    );
    // A failed CDN load must not poison every later run.
    pyodidePromise.catch(() => {
      pyodidePromise = null;
    });
  }
  return pyodidePromise;
}

self.onmessage = async (event: MessageEvent<RunRequest>) => {
  const { id, driver } = event.data;
  try {
    const pyodide = await loadPyodide();
    const output = String(await pyodide.runPythonAsync(driver));
    self.postMessage({ id, output });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
