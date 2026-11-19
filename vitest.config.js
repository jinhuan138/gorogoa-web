import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: "happy-dom",
    environmentOptions: {
      happyDOM: { url: "https://gorogoa.test/owner/repo/" },
    },
    include: ["tests/**/*.test.js"],
    testTimeout: 120000,
    restoreMocks: true,
    unstubGlobals: true,
  },
});
