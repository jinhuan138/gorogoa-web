const byId = (id) => document.getElementById(id);
const status = byId("status"),
  selection = byId("selection"),
  mode = byId("mode"),
  search = byId("search");
const canvas = byId("canvas"),
  context = canvas.getContext("2d");
const assetUrl = (relative) => new URL(relative, document.baseURI).href;
async function load(relative) {
  const response = await fetch(assetUrl(relative));
  if (!response.ok)
    throw new Error(`无法读取 ${relative} (${response.status})`);
  return response.json();
}
let textures = [],
  regions = [],
  visible = [],
  request = 0;
function refresh() {
  const term = search.value.trim().toLocaleLowerCase();
  visible = (mode.value === "regions" ? regions : textures).filter((item) =>
    (item.source || item.resourcePath || item.name)
      .toLocaleLowerCase()
      .includes(term),
  );
  selection.replaceChildren(
    ...visible.map((item, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = item.source || item.resourcePath || item.name;
      return option;
    }),
  );
  status.textContent = `已恢复 ${textures.length} 张图片 · ${regions.length} 个画面区域 · 当前找到 ${visible.length} 项`;
  render();
}
async function render() {
  const ticket = ++request,
    item = visible[Number(selection.value)];
  if (!item) {
    canvas.width = canvas.height = 1;
    byId("caption").textContent = "没有找到匹配的画面";
    return;
  }
  status.textContent = "正在加载画面…";
  try {
    const image = new Image();
    image.src = assetUrl(item.textureUrl || item.url);
    await image.decode();
    if (ticket !== request) return;
    const width = item.originalW || item.width,
      height = item.originalH || item.height;
    canvas.width = width;
    canvas.height = height;
    context.clearRect(0, 0, width, height);
    if (item.source)
      context.drawImage(
        image,
        item.u,
        image.naturalHeight - item.v - item.h,
        item.w,
        item.h,
        item.offsetX,
        height - item.offsetY - item.h,
        item.w,
        item.h,
      );
    else context.drawImage(image, 0, 0);
    byId("caption").textContent =
      `${item.source || item.resourcePath || item.name} · ${width} × ${height}`;
    status.textContent = `已恢复 ${textures.length} 张图片 · ${regions.length} 个画面区域 · 当前找到 ${visible.length} 项`;
  } catch (error) {
    if (ticket === request) {
      status.textContent = error.message;
      context.clearRect(0, 0, canvas.width, canvas.height);
    }
  }
}
mode.addEventListener("change", refresh);
search.addEventListener("input", refresh);
selection.addEventListener("change", render);
byId("background").addEventListener("click", () =>
  byId("stage").classList.toggle("dark"),
);
try {
  const [manifest, atlas, summary] = await Promise.all([
    load("assets/manifest.json"),
    load("assets/data/atlases.json"),
    load("assets/data/project-summary.json"),
  ]);
  textures = manifest.textures.filter((item) => item.status === "converted");
  regions = atlas.entries;
  byId("summary").textContent =
    `${summary.counts.Card} 张卡片、${summary.counts.Scene} 个场景、${summary.counts.SceneLocation} 个场景位置。`;
  regions.sort((a, b) => a.source.localeCompare(b.source));
  search.value = "card002/city1";
  refresh();
} catch (error) {
  status.textContent = `加载失败：${error.message}`;
}
