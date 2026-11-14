import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    // shortcut: a Settings test took 5.4 s on a slow Windows runner and failed a release at
    // the 5 s default. Raise the ceiling; find the slow render if it gets near 15 s.
    testTimeout: 15_000,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // Vitest blanks CSS imports by default; designSystem.test.ts reads styles.css as text.
    css: true,
    env: {
      NODE_ENV: "test",
    },
  },
});
