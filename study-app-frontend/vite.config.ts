import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * CSP for the System Design worker (src/lib/sdPython.worker.ts), sent with the
 * worker script itself: a module worker obeys its own response's CSP, not the
 * page's. The worker runs untrusted Python (MCP-written test modules); it
 * already cannot reach the page or localStorage, and this removes the network
 * too, except the pinned Pyodide build. No nested workers to escape it.
 * vercel.json serves the same string in prod (sdWorkerCsp.test.ts checks).
 */
const PYODIDE_CDN = "https://cdn.jsdelivr.net/pyodide/v0.27.5/full/";
export const SD_WORKER_CSP = [
  "default-src 'none'",
  `script-src 'self' ${PYODIDE_CDN} 'wasm-unsafe-eval'`,
  `connect-src ${PYODIDE_CDN}`,
  "worker-src 'none'",
].join("; ");

function sdWorkerCsp(): Plugin {
  return {
    name: "sd-worker-csp",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (/\/sdPython\.worker\.ts(\?|$)/.test((req as { url?: string }).url ?? "")) {
          res.setHeader("Content-Security-Policy", SD_WORKER_CSP);
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), sdWorkerCsp()],
  server: {
    port: 5173,
  },
});
