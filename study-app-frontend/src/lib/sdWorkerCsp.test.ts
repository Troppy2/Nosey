import { describe, expect, it } from "vitest";

import viteConfigSource from "../../vite.config.ts?raw";
import vercelConfig from "../../vercel.json";

const POLICY =
  "default-src 'none'; script-src 'self' https://cdn.jsdelivr.net/pyodide/v0.27.5/full/ 'wasm-unsafe-eval'; " +
  "connect-src https://cdn.jsdelivr.net/pyodide/v0.27.5/full/; worker-src 'none'";

describe("SD worker CSP (untrusted Python gets no network)", () => {
  it("is served on the built worker by vercel.json", () => {
    const rule = vercelConfig.headers.find((entry) => entry.source === "/assets/sdPython.worker-(.*).js");
    const csp = rule?.headers.find((header) => header.key === "Content-Security-Policy")?.value;
    expect(csp).toBe(POLICY);
  });

  it("matches the dev server policy in vite.config.ts", () => {
    expect(viteConfigSource).toContain("const PYODIDE_CDN = \"https://cdn.jsdelivr.net/pyodide/v0.27.5/full/\"");
    for (const directive of ["default-src 'none'", "'wasm-unsafe-eval'", "connect-src ${PYODIDE_CDN}", "worker-src 'none'"]) {
      expect(viteConfigSource).toContain(directive);
    }
  });
});
