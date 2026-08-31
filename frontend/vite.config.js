import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev-only convenience server. Production (Vercel) keeps serving the built
// static output per vercel.json.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 }
});
