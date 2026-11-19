import { resolve } from "node:path";
import vue from "@vitejs/plugin-vue";
import { stagePages } from "./tools/pages/stage-pages.mjs";

let rootDir;
export default {
  base: "./",
  build: { outDir: "dist", emptyOutDir: true, copyPublicDir: false },
  plugins: [
    vue(),
    {
      name: "gorogoa-pages-assets",
      apply: "build",
      configResolved(config) {
        rootDir = config.root;
      },
      writeBundle({ dir }) {
        return stagePages({
          source: resolve(rootDir, "public"),
          output: resolve(rootDir, dir),
        });
      },
    },
  ],
};
