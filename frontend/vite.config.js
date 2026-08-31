import { defineConfig } from "vite";

// Dev-only convenience server. Production (Vercel) keeps serving the raw
// static files per vercel.json (buildCommand/installCommand: null) — this
// config is never invoked in that path.
export default defineConfig({
  server: { port: 5173 }
});
