import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Port 3010: avoids collision with portfolio dev (9090), nextjs (3004),
    // dashboard-frontend (3006), dashboard-backend (3007), fargate-frontend (3008),
    // fargate-backend (3009).
    port: 3010,
    strictPort: true,
  },
});
