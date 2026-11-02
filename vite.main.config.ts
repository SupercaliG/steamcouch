import { defineConfig } from "vite";

// Builds the Electron main process (electron/main.ts + src/main/**) and the
// preload script into CommonJS files: dist-electron/{main,preload}.cjs.
export default defineConfig({
  build: {
    ssr: true,
    outDir: "dist-electron",
    emptyOutDir: true,
    target: "node22",
    minify: false,
    rollupOptions: {
      input: { main: "electron/main.ts", preload: "electron/preload.ts" },
      external: ["electron", /^node:/],
      output: { format: "cjs", entryFileNames: "[name].cjs" },
    },
  },
});
