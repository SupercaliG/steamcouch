import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { createApi } from "./src/main/api.ts";

// Dev-only: serves the dashboard API from the Vite dev server. On the couch PC
// the Electron shell (electron/main.ts) serves the same API.
//
// STEAMCOUCH_STEAM_DIR points at a Steam root. Default: ./.steam-snapshot,
// a copy of the couch PC's Steam metadata. Game launches and power actions
// are simulated in development.
function devApi(): Plugin {
  const handleApi = createApi({
    steamDir: resolve(process.env.STEAMCOUCH_STEAM_DIR ?? ".steam-snapshot"),
    dataDir: resolve(".cache/data"),
  });

  return {
    name: "steamcouch-dev-api",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/api/")) return next();
        let body = "";
        req.on("data", (chunk: Buffer) => (body += chunk.toString()));
        req.on("end", () => {
          handleApi(req.method ?? "GET", req.url!, body || undefined)
            .then((r) => {
              res.statusCode = r.status;
              res.setHeader("Content-Type", r.type);
              res.end(r.body);
            })
            .catch((err: unknown) => {
              res.statusCode = 500;
              res.end(String(err));
            });
        });
      });
    },
  };
}

export default defineConfig({
  // Relative asset paths so the build also works from app://ui/ in Electron.
  base: "./",
  plugins: [devApi()],
});
