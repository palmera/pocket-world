import { defineConfig } from "vite";

export default defineConfig({
  // Relative base so the same build works on GitHub Pages (subpath) and inside a
  // Capacitor WKWebView (file://) without rewrites.
  base: "./",
  // host: true → reachable on the LAN so an iPad on the same Wi-Fi can open it.
  server: { open: true, host: true },
  build: { target: "es2020" },
});
