# Gorogoa 网页移植

目标：使用原版数据和素材，还原全部游戏画面、谜题、动画和声音，以 Vite 构建为 GitHub Pages 静态站点。

完整通关回归已从新游戏覆盖序章、五个正章、五段终局回忆、尾声和结局。内置浏览器已显示原版窗景、结局图案和片尾名单，并验证折纸暂停、取消载入、声音启用、继续游戏和片尾翻页。主游戏各场景、音画时序和全部原版设置的对照仍待验收。游戏入口为 index.html，素材核对工具为 assets.html。

## 本机环境

- Node 22.16.0；已在 `package.json` 的 Volta 配置和 `.nvmrc` 固定。
- 本机已有 Volta 管理的 Node 22.16.0；未修改全局默认版本。
- 唯一直接开发依赖：Vite 8.3.6。其必需依赖随 npm 安装；安装时禁用了包安装脚本。
- 不需要 React、Canvas 库、Unity 编辑器或 Python 依赖。

在 Node 22 环境中执行 `npm run dev` 可打开游戏页面。也可以用 `node work/serve.mjs` 开启只读本机预览，地址为 http://127.0.0.1:4178/。`node tools/check-prologue.mjs` 用实际网页入口模拟整条通关路线的输入和计时，追加 `--ending` 验证原版尾声检查点、结局贴图与片尾名单的自动和手动翻页。两种检查均不启动浏览器或构建。

本次没有执行 `npm run build`、编译命令、Git 初始化、提交、推送或发布。GitHub 工作流仅接受手动触发；只有在你准备好并批准发布后，再上传仓库、启用 Pages 和运行发布。

Vite 使用相对路径发布。构建时根据正式版图集索引复制 709 张贴图、291 段原声音频、运行数据及界面素材。运行 `node tools/stage-pages.mjs` 可只读检查资源引用和体积。已核对的静态资源共 909,592,434 字节，另有 Vite 生成的网页、脚本、样式和字体。[GitHub Pages 用量上限](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)

## 文档

- `docs/DESIGN.md`：架构、逐项还原范围和验收办法。
- `docs/ANALYSIS.md`：已观察到的事实、独立解析结果、推断和未知项。
- `docs/CHANGES.md`：逐文件说明。
- `docs/evidence/rea-session.json`：REA 原始证据。默认不加入 Git。

## 数据目录

- `work/`：原始导出、未压缩资源包和元数据目录。约 1.6 GB 以上，仅用于本地分析，已忽略。
- `public/assets/textures/`：872 张恢复后的 PNG 图集和界面图片，约 792 MiB。发布时按正式版引用筛选。
- `public/assets/data/project.xml`：原版正式项目配置，保留原有引用与顺序。
- `public/assets/data/atlases.json`：正式版画面和动画的图集裁切数据。
- `public/assets/data/runtime-*-save.json`：原版五章及尾声检查点。保留原格子、剧情阶段、选中卡与叠层。
- `public/assets/audio/`：291 段原声 Ogg 与 755 条原版音频事件。原声由游戏的 Vorbis 包重封装，无重编码。
- `public/assets/manifest.json`：图片尺寸、来源资源路径及 SHA-256。

PNG 是从原版 BC1/BC3 等纹理解码后生成的无损文件。这里的“无损”指对已解码像素的保存，不代表恢复了压缩前美术母版，也不代表已经验证与 GPU 的输出逐像素一致。

## 重现分析

按顺序运行：

1. `node tools/inspect-game.mjs "E:\SteamLibrary\steamapps\common\Gorogoa"`
2. `node tools/export-resources.mjs`
3. `node tools/map-resources.mjs`
4. 在 PowerShell 中运行 `tools/prepare-data.ps1`
5. `npm run check:codecs` 和 `npm run check:assets`

这些步骤只读取原游戏，所有结果写入本项目。分析工具只支持已经确认的 Unity 2017 / UnityFS 6 / SerializedFile 17，遇到未支持的版本或格式会报错，不能据此宣称通用 Unity 解包能力。

