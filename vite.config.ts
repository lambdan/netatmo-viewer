import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { execSync } from "node:child_process";
import process from "node:process";

/**
 * Shown in the app's footer, e.g. "v0.5.1", or "v0.5.1-2-gabc1234" for two commits after it.
 * The Docker build has no .git, so the workflow passes it in as APP_VERSION.
 */
function appVersion(): string {
  if (process.env.APP_VERSION) return process.env.APP_VERSION;
  try {
    return execSync("git describe --tags --always", { stdio: ["ignore", "pipe", "ignore"] })
      .toString().trim();
  } catch {
    return "dev";
  }
}

export default defineConfig({
  plugins: [vue()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion()),
  },
  build: {
    // iPad mini 2 is stuck on iOS 12 / Safari 12, so keep the output old-fashioned.
    target: "safari12",
    cssTarget: "safari12",
  },
  server: {
    proxy: { "/api": "http://localhost:8080" },
  },
});
