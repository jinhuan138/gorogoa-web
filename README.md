# Gorogoa 网页移植

目标：使用原版数据和素材，还原全部游戏画面、谜题、动画和声音，以 Vite 构建为 GitHub Pages 静态站点。

完整通关回归覆盖序章、五个正章、五段终局回忆、尾声和结局。界面已迁移到 Vue，样式采用 Sass；游戏时钟、状态机、关键帧、Canvas 绘制与声音时间轴仍为纯 JavaScript。主游戏各场景及音画时序与原版的逐项对照仍待验收。游戏入口为 `index.html`，素材核对工具为 `assets.html`。

## 本机环境

- Node 22.16.0；已在 `package.json` 的 Volta 配置和 `.nvmrc` 固定。
- 兼容范围为 Node `^20.19.0 || >=22.12.0`；本轮自动检查使用 Node 20.19.4，未修改全局默认版本。
- 界面依赖 Vue 3.5.45；构建采用 Vite 8.3.6、Vue 插件及 `sass-embedded`。
- 测试采用 Vitest、Happy DOM 和 Vue Test Utils；Prettier 统一格式。具体版本由 `package-lock.json` 锁定。
- 不增加独立动画库、Three.js、Pinia、Router 或 Canvas 库。

执行 `npm ci` 安装锁定依赖，`npm run dev` 启动游戏；`npm run build` 构建生产版本，`npm run preview` 预览构建产物。

`npm test` 挂载真实 Vue 组件，回归完整通关及界面交互；绘图、音频和时钟外围使用测试模拟。`npm run test:ui` 单独验证菜单和设置。`node tools/checks/check-prologue.mjs --ending` 验证尾声检查点和片尾翻页，`--chapter-menu` 验证章节载入。`npm run format:check` 检查源码格式；这些测试不启动浏览器或执行构建。

格式化与去重基线已单独提交为 `07fb867`；Vue/Sass/H5 重构在自动验收后另行提交。尚未推送或发布。生产构建已验证，GitHub 工作流仅接受手动触发；发布仍需另行批准。

无头 Chromium 已验证最终构建在 320×568、390×844、844×390、1280×800 下的布局和菜单操作，并验证旋转、真实触摸序章与拆卡保存、语言、声音解锁、全屏状态及 reduced-motion；素材核对页的手机和桌面显示、结局 WebGL 与片尾翻页亦通过。截图和结果保存在被忽略的 `work/verification/`，浏览器验证工具未加入项目依赖。已知 `favicon.ico` 的 404 单独排除，未发现其他控制台错误或资源请求失败。

原始数据检查 `check-project.mjs`、`check-cil.mjs` 和 `check-audio.mjs` 依赖被忽略的 `work/` 导出或原游戏安装目录，当前机器缺少相关文件，不能计为通过。Chromium 手机模拟不能替代 iOS Safari / Android 实机验收；安全区、真实地址栏变化及设备音频行为仍待实机确认。

Vite 使用相对路径发布。构建时根据真实引用筛选资源，发布集合为 1036 项，含 732 张贴图、291 段原声音频及运行数据。运行 `node tools/pages/stage-pages.mjs` 可只读检查资源引用和体积。静态资源共 650,245,594 字节（约 650.25 MB / 620.12 MiB），另有 Vite 生成的网页、脚本、样式和字体；本轮未修改 `public/assets`。[GitHub Pages 用量上限](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)

## 文档

- `docs/DESIGN.md`：架构、逐项还原范围和验收办法。
- `docs/ANALYSIS.md`：已观察到的事实、独立解析结果、推断和未知项。
- `docs/CHANGES.md`：逐文件说明。
- `docs/evidence/rea-session.json`：REA 原始证据。默认不加入 Git。

## 源码与工具目录

- `src/ui/`：Vue 单文件组件、界面连接和设置持久化。
- `src/game/`：游戏调度、输入与开场、结局、片尾控制器。
- `src/engine/render/`、`audio/`、`model/`：渲染、音频与游戏模型；`animation.js` 保留原版动画采样。
- `src/i18n/`、`resources/`：语言与共用资源辅助函数。
- `src/styles/game.scss`、`src/inspector/style.scss`：游戏与素材核对页的嵌套 Sass 样式。
- `tools/checks/`、`extract/`、`pages/`：独立校验、原始数据提取及发布资源筛选。
- `tests/`：真实 Vue 界面测试与确定性通关回归。

## 数据目录

- `work/`：原始导出、未压缩资源包和元数据目录。约 1.6 GB 以上，仅用于本地分析，已忽略。
- `public/assets/textures/`：872 张图集和界面图片，包括 867 张无损 WebP、5 张 PNG。发布时按真实引用筛选。
- `public/assets/data/project.xml`：原版正式项目配置，保留原有引用与顺序。
- `public/assets/data/atlases.json`：正式版画面和动画的图集裁切数据。
- `public/assets/data/runtime-*-save.json`：原版五章及尾声检查点。保留原格子、剧情阶段、选中卡与叠层。
- `public/assets/audio/`：291 段原声 Ogg 与 755 条原版音频事件。原声由游戏的 Vorbis 包重封装，无重编码。
- `public/assets/manifest.json`：图片尺寸、来源资源路径及 SHA-256。

PNG 和无损 WebP 保存从原版 BC1/BC3 等纹理解码得到的像素。这里的“无损”指对已解码像素的保存，不代表恢复了压缩前美术母版，也不代表已经验证与 GPU 的输出逐像素一致。

## 重现分析

按顺序运行：

1. `node tools/extract/inspect-game.mjs "E:\SteamLibrary\steamapps\common\Gorogoa"`
2. `node tools/extract/export-resources.mjs`
3. `node tools/extract/map-resources.mjs`
4. 在 PowerShell 中运行 `tools/extract/prepare-data.ps1`
5. `npm run check:codecs` 和 `npm run check:assets`

这些步骤只读取原游戏，所有结果写入本项目。分析工具只支持已经确认的 Unity 2017 / UnityFS 6 / SerializedFile 17，遇到未支持的版本或格式会报错，不能据此宣称通用 Unity 解包能力。

