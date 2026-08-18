import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server binds to loopback only and proxies /api to the Express server
// (server/src/app.ts, config.HOST:config.PORT), keeping the client a pure
// rendering tier over an explicit local API boundary.
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:5174",
        changeOrigin: true,
      },
    },
  },
});
