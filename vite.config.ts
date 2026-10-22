import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  build: {
    // iPad mini 2 is stuck on iOS 12 / Safari 12, so keep the output old-fashioned.
    target: "safari12",
    cssTarget: "safari12",
  },
  server: {
    proxy: { "/api": "http://localhost:8080" },
  },
});
