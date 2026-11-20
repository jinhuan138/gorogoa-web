# Gorogoa 网页移植

本项目使用原版数据和素材，还原全部游戏画面、谜题、动画和声音，并用 Vite 构建为 GitHub Pages 静态站点。

游戏入口为 `index.html`，素材核对工具为 `assets.html`。界面层使用 Vue 和 Sass；游戏时钟、状态机、关键帧、Canvas 绘制和声音时间轴仍是纯 JavaScript。完整通关回归覆盖序章、五个正章、五段终局回忆、尾声和结局；主游戏各场景的音画时序与原版的逐项对照仍待验收。

## 本机环境

- Node 22.16.0，已在 `.nvmrc` 和 `package.json` 的 Volta 配置中固定；兼容范围为 `^20.19.0 || >=22.12.0`。
- 包管理器为 pnpm 10.26.1，依赖由 `pnpm-lock.yaml` 锁定。
- 运行依赖：Vue 3.5.45；Anime.js 4.5.0，仅用于启动页和片尾名单的淡入淡出。
- 构建依赖：Vite 8.3.6、`@vitejs/plugin-vue`、`sass-embedded`。
- 测试与格式：Vitest、Happy DOM、Vue Test Utils、Prettier。
- 不引入 Three.js、Pinia、Router 或 Canvas 库；核心运动沿用原版采样函数，不交给补间库推进。

## 常用命令

- `pnpm install --frozen-lockfile`：安装锁定依赖。
- `pnpm dev`：启动游戏；地址后加 `?timing` 可在控制台查看启动各阶段耗时。
- `pnpm build`：构建生产版本；`pnpm preview`：预览构建产物。
- `pnpm test`：挂载真实 Vue 组件，回归完整通关、界面交互、界面音效和核心运动；绘图、音频和时钟外围使用测试模拟。`pnpm test:ui` 只运行菜单和设置测试。
- `node tools/checks/check-prologue.mjs --ending`：验证尾声检查点和片尾翻页；`--chapter-menu`：验证章节载入。
- `pnpm format:check`：本地检查源码格式，不在发布工作流中运行。

以上测试都不启动浏览器，也不执行构建。

## 发布

推送到 `main` 或手动触发时，`.github/workflows/pages.yml` 会依次运行 `pnpm test`、`check:codecs`、`check:assets`、尾声与章节菜单回归，然后构建并部署到 GitHub Pages。`0c6e3d5` 的远端构建与部署已成功。

Vite 使用相对路径发布，构建时按真实引用筛选资源：发布集合共 1036 项，含 732 张贴图、291 段原声音频和运行数据。运行 `node tools/pages/stage-pages.mjs` 可只读检查资源引用和体积。当前静态资源共 646,766,297 字节（约 646.77 MB / 616.80 MiB），另有 Vite 生成的网页、脚本、样式和字体。参见 [GitHub Pages 用量上限](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)。

## 验证现状

无头 Chromium 已在 320×568、390×844、844×390、1280×800 四个视口下验证构建产物的布局和菜单操作，覆盖旋转、真实触摸走序章、拆卡保存、语言、声音解锁、全屏状态和 reduced-motion；素材核对页的手机与桌面显示、结局 WebGL 和片尾翻页也已通过。截图和结果保存在被忽略的 `work/verification/`，浏览器验证工具未加入项目依赖。除已知的 `favicon.ico` 404 外，未发现控制台错误或资源请求失败。

原始数据检查 `check-project.mjs`、`check-cil.mjs` 和 `check-audio.mjs` 依赖被忽略的 `work/` 导出或原游戏安装目录，缺少这些文件时不能计为通过。Chromium 手机模拟不能替代 iOS Safari / Android 实机验收，安全区、真实地址栏变化和设备音频行为仍待实机确认。

## 文档

- `docs/DESIGN.md`：架构、还原范围和验收办法。
- `docs/ANALYSIS.md`：已观察到的事实、独立解析结果、推断和未知项。
- `docs/CHANGES.md`：按阶段记录的逐文件变化。
- `docs/evidence/rea-session.json`：REA 原始证据，仅保存在本机，不加入 Git。

## 源码与工具目录

- `src/ui/`：Vue 单文件组件、界面动作（`useGame.js`）和设置持久化。
- `src/game/`：游戏调度与输入（`runtime.js`）、核心运动控制器（`motion.js`）、界面时间线（`timeline.js`），以及开场、结局和片尾画面。
- `src/engine/render/`、`audio/`、`model/`：渲染、音频与游戏模型；`animation.js` 保留原版动画采样。
- `src/i18n/`、`src/resources/`：语言、资源辅助函数和启动加载打点。
- `src/styles/game.scss`、`src/inspector/style.scss`：游戏与素材核对页的 Sass 样式。
- `tools/checks/`、`extract/`、`pages/`：独立校验、原始数据提取和发布资源筛选。
- `tests/`：真实 Vue 界面测试、核心运动测试和确定性通关回归。

## 数据目录

- `work/`：原始导出、未压缩资源包和元数据目录，约 1.6 GB 以上，仅用于本地分析，已忽略。
- `public/assets/textures/`：872 张图集和界面图片，其中 867 张为无损 WebP、5 张为 PNG，发布时按真实引用筛选。
- `public/assets/data/project.xml`：原版正式项目配置，保留原有引用和顺序。
- `public/assets/data/runtime-project.json`：由项目配置生成的运行时逻辑树，已剔除 `fieldModificationLog`、`deletionLog`、`lastModified` 等编辑器元数据。
- `public/assets/data/atlases.json`：正式版画面和动画的图集裁切数据。
- `public/assets/data/runtime-*-save.json`：原版五章和尾声检查点，保留原格子、剧情阶段、选中卡和叠层。
- `public/assets/audio/`：291 段原声 Ogg 和 755 条原版音频事件。原声由游戏的 Vorbis 包重封装，未重编码。
- `public/assets/manifest.json`：图片尺寸、来源资源路径和 SHA-256。

PNG 和无损 WebP 保存的是从原版 BC1/BC3 等纹理解码得到的像素。这里的“无损”只针对已解码像素，既不代表恢复了压缩前的美术母版，也不代表已验证与 GPU 输出逐像素一致。

## 重现分析

按顺序运行：

1. `node tools/extract/inspect-game.mjs "E:\SteamLibrary\steamapps\common\Gorogoa"`
2. `node tools/extract/export-resources.mjs`
3. `node tools/extract/map-resources.mjs`
4. 在 PowerShell 中运行 `tools/extract/prepare-data.ps1`
5. `pnpm check:codecs` 和 `pnpm check:assets`

这些步骤只读取原游戏，结果全部写入本项目。分析工具只支持已确认的 Unity 2017 / UnityFS 6 / SerializedFile 17，遇到其他版本或格式会报错，不能据此宣称具备通用的 Unity 解包能力。
