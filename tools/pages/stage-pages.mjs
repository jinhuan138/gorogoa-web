import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  STARTUP_SLIDES,
  STARTUP_MUSIC,
} from "../../src/game/screens/startup.js";
import { UI_TEXTURES } from "../../src/resources/textures.js";

const SOURCE = resolve(dirname(fileURLToPath(import.meta.url)), "../../public");
const DATA_FILES = [
  "atlases.json",
  "runtime-project.json",
  "credits.json",
  "NotoSerif-OFL.txt",
  ...[1, 2, 3, 4, 5].map((chapter) => `runtime-chapter${chapter}-save.json`),
  "runtime-end-save.json",
].map((name) => `assets/data/${name}`);

export async function stagePages({ source = SOURCE, output } = {}) {
  const read = async (file) =>
    JSON.parse(
      (await readFile(resolve(source, file), "utf8")).replace(/^\uFEFF/, ""),
    );
  const [original, atlases, audio] = await Promise.all([
    read("assets/manifest.json"),
    read("assets/data/atlases.json"),
    read("assets/audio/manifest.json"),
  ]);
  const atlasKeys = new Set(atlases.entries.map((region) => region.textureKey));
  const startupKeys = new Set(STARTUP_SLIDES.map((slide) => slide.key));
  const uiNames = new Set(UI_TEXTURES);
  const textures = original.textures
    .filter(
      (texture) =>
        texture.status === "converted" &&
        (atlasKeys.has(texture.key) ||
          startupKeys.has(texture.key) ||
          uiNames.has(texture.name) ||
          texture.key.startsWith("sharedassets0-assets/")),
    )
    .map(({ key, name, width, height, url, status }) => ({
      key,
      name,
      width,
      height,
      url,
      status,
    }));
  const textureByKey = new Map(
    textures.map((texture) => [texture.key, texture]),
  );
  for (const slide of STARTUP_SLIDES) {
    if (textureByKey.get(slide.key)?.url !== slide.url)
      throw new Error(`启动贴图缺失 ${slide.label}`);
  }
  if (!audio.clips.some((clip) => clip.key === STARTUP_MUSIC))
    throw new Error("启动序曲缺失");
  for (const region of atlases.entries) {
    if (textureByKey.get(region.textureKey)?.url !== region.textureUrl) {
      throw new Error(`正式版图集没有对应图片 ${region.textureKey}`);
    }
  }
  for (const name of UI_TEXTURES) {
    if (textures.filter((texture) => texture.name === name).length !== 1) {
      throw new Error(`界面贴图缺失或重名 ${name}`);
    }
  }
  const clips = audio.clips.map(
    ({ key, name, url, channels, dataSha256, durationExpected }) => ({
      key,
      name,
      url,
      channels,
      dataSha256,
      durationExpected,
    }),
  );
  const files = new Set([
    ...DATA_FILES,
    "assets/audio/events.json",
    ...textures.map((texture) => texture.url),
    ...clips.map((clip) => clip.url),
  ]);
  const manifests = new Map([
    ["assets/manifest.json", JSON.stringify({ textures, failures: [] })],
    ["assets/audio/manifest.json", JSON.stringify({ clips })],
  ]);
  let bytes = [...manifests.values()].reduce(
    (sum, content) => sum + Buffer.byteLength(content),
    0,
  );
  for (const file of files) {
    if (
      !/^assets\/(data|textures|audio)\/[\w.() ,+@!'-]+$/u.test(file) ||
      typeof file !== "string"
    ) {
      throw new Error(`无效的静态资源路径 ${file}`);
    }
    const info = await stat(resolve(source, file));
    if (!info.isFile()) throw new Error(`静态资源不是文件 ${file}`);
    bytes += info.size;
  }
  if (bytes >= 1_000_000_000)
    throw new Error("发布资源已达到 GitHub Pages 的 1 GB 上限");

  if (output) {
    const directories = new Set(
      [...files, ...manifests.keys()].map((file) =>
        dirname(resolve(output, file)),
      ),
    );
    await Promise.all(
      [...directories].map((directory) =>
        mkdir(directory, { recursive: true }),
      ),
    );
    for (const file of files)
      await copyFile(resolve(source, file), resolve(output, file));
    await Promise.all(
      [...manifests].map(([file, content]) =>
        writeFile(resolve(output, file), content),
      ),
    );
  }
  console.log(
    `Pages 静态资源 ${files.size + manifests.size} 项，${textures.length} 张贴图，${clips.length} 段音频，共 ${bytes} 字节`,
  );
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
)
  await stagePages();
