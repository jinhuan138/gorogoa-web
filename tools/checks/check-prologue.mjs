import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const root = args.find((arg) => !arg.startsWith("--"));
const mode = args.includes("--ending")
  ? "ending"
  : args.includes("--chapter-menu")
    ? "chapter-menu"
    : "full";
const projectRoot = new URL("../../", import.meta.url);
const result = spawnSync(
  process.execPath,
  [
    fileURLToPath(new URL("node_modules/vitest/vitest.mjs", projectRoot)),
    "run",
    "tests/prologue.test.js",
    "--config",
    "vitest.config.js",
  ],
  {
    cwd: fileURLToPath(projectRoot),
    stdio: "inherit",
    env: {
      ...process.env,
      GOROGOA_CHECK_MODE: mode,
      ...(root ? { GOROGOA_CHECK_ROOT: root } : {}),
    },
  },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
