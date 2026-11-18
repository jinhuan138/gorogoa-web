import { resolve } from 'node:path';
import { stagePages } from './tools/stage-pages.mjs';

let rootDir;
export default {
  base: './',
  build: { outDir: 'dist', emptyOutDir: true, copyPublicDir: false },
  plugins: [{
    name: 'gorogoa-pages-assets',
    apply: 'build',
    configResolved(config) {
      rootDir = config.root;
    },
    writeBundle({ dir }) {
      return stagePages({ source: resolve(rootDir, 'public'), output: resolve(rootDir, dir) });
    },
  }],
};
