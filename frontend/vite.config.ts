import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiTarget = "http://127.0.0.1:4000";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    strictPort: false,
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
        cookieDomainRewrite: "",
        cookiePathRewrite: "/",
      },
      "/sub": {
        target: apiTarget,
        changeOrigin: true,
      },
      "/comfort": {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
});
