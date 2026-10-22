import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
/**
 * CSP for the System Design worker (src/lib/sdPython.worker.ts), sent with the
 * worker script itself: a module worker obeys its own response's CSP, not the
 * page's. The worker runs untrusted Python (MCP-written test modules); it
 * already cannot reach the page or localStorage, and this removes the network
 * too, except the pinned Pyodide build. No nested workers to escape it.
 * vercel.json serves the same string in prod (sdWorkerCsp.test.ts checks).
 */
var PYODIDE_CDN = "https://cdn.jsdelivr.net/pyodide/v0.27.5/full/";
export var SD_WORKER_CSP = [
    "default-src 'none'",
    "script-src 'self' ".concat(PYODIDE_CDN, " 'wasm-unsafe-eval'"),
    "connect-src ".concat(PYODIDE_CDN),
    "worker-src 'none'",
].join("; ");
function sdWorkerCsp() {
    return {
        name: "sd-worker-csp",
        configureServer: function (server) {
            server.middlewares.use(function (req, res, next) {
                var _a;
                if (/\/sdPython\.worker\.ts(\?|$)/.test((_a = req.url) !== null && _a !== void 0 ? _a : "")) {
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
