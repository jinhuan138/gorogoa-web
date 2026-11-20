# 变更记录

按阶段从早到晚记录。各节如实保留当时的状态，后文更新覆盖前文；当前状态以 README.md 为准。所有改动只涉及本项目，不修改原游戏或其他项目。

## 2026-11-06 初始分析与素材核对

本阶段的依赖、工作流和入口已在后续阶段调整：`package-lock.json` 改为 `pnpm-lock.yaml`，素材核对页移至 `assets.html`，样式改为 Sass，工具归入 `tools/`。

| 文件 | 用途 |
|---|---|
| README.md | 当前状态、运行环境、校验和分析重现步骤 |
| package.json | Node 22、Vite 唯一直接依赖和开发/校验命令 |
| package-lock.json | 锁定安装的 Vite 及必需依赖 |
| .nvmrc | 项目 Node 版本 22.16.0 |
| .gitignore | 忽略依赖、构建产物、原始导出和 REA 会话记录 |
| vite.config.js | 静态构建与 GitHub Pages 相对资源路径 |
| .github/workflows/pages.yml | 仅手动触发的 Pages 发布配置，尚未执行 |
| index.html | 素材核对页面入口，明确区分游戏完成版 |
| src/inspector/main.js | 图片/区域切换、搜索、异步图片加载和原始尺寸裁切预览 |
| src/inspector/style.css | 核对页布局、透明背景和窄屏适配 |
| tools/extract/inspect-game.mjs | 受限 UnityFS/LZ4、序列化对象及 PE 元数据只读解析 |
| tools/extract/export-resources.mjs | 导出文本、纹理解析与无损 PNG 输出 |
| tools/extract/texture-codecs.mjs | 原生 BC1/BC3 像素解码，不增加依赖 |
| tools/checks/check-texture-codecs.mjs | 解码语义与截断输入校验 |
| tools/extract/map-resources.mjs | 解析正式版/演示版资源路径与对象引用 |
| tools/extract/prepare-data.ps1 | 关联正式版静态/动画图集，生成项目统计和网页数据 |
| tools/checks/check-assets.mjs | PNG、裁切范围、引用和抽样解压校验 |
| docs/DESIGN.md | 按原版数据设计移植架构、实现顺序和验收 |
| docs/ANALYSIS.md | 记录证据、独立解析结果、限制和未知项 |
| docs/CHANGES.md | 本文件 |
| docs/evidence/rea-session.json | 两次 REA 分析的原始证据记录 |
| public/assets/manifest.json | 全部纹理、正式资源路径、输出图片和哈希 |
| public/assets/data/project.xml | 原版正式项目配置的字节副本 |
| public/assets/data/project-summary.json | 卡片、场景、状态、脚本统计 |
| public/assets/data/atlases.json | 6238 个正式版静态/动画区域与图片关联 |
| public/assets/textures/*.png | 872 张恢复后的原版纹理图片 |
| work/*.json、work/bundle-data.bin | 本地分析目录、图集来源、展开资源与成员名录 |
| work/extracted-text/*.txt | 236 个原始文本资源的字节导出 |

当时 src/engine 和 src/chapters 目录仅做预留，没有写入未经验证的游戏逻辑。`work/serve.mjs` 是本机只读静态预览服务，仅监听 127.0.0.1:4178，不构建、不编译，也不访问项目外的文件。

## 2026-11-07 游戏入口与核心模型

新增 src/engine/model/project.js（原版逻辑树索引）、camera.js（原版相机与视差）、atlas.js（图集与原图裁切）、renderer.js（场景合成）、animation.js（播放列表、关键帧与插值）、state.js（初始状态、谓词、转移和动画门控）和 storage.js（完整进度快照与校验）。新增 src/game/runtime.js 和 game.css 作为游戏入口；index.html 切换为游戏，旧素材工具移至 assets.html。

新增分析与测试：tools/extract/prepare-runtime.ps1、inspect-cil.mjs、check-cil.mjs、check-project.mjs、check-camera.mjs、check-renderer.mjs、check-animation.mjs、check-state.mjs、check-storage.mjs，以及 runtime-project、runtime-chapter1-save、runtime-manifest 派生数据。第一章存档明确作为检查点，没有误当新游戏的起点。

已按真实 XML 逐元素、属性和顺序核对 116066 个元素、358627 个属性。修复了 PowerShell 中 XML name 属性遮蔽标签、CIL 非有限数丢失、OffsetViewpoint 收缩公式、动画激活时钟、动画可打断候选顺序、自循环重新激活和 hover 热点缓存等问题。

内置浏览器中已显示原版城市合成和 10 部件角色动画，并实际点击返回 window 位置。当时全部检查均未执行构建，也未提交、推送或发布。

同日补记：已在内置浏览器中走通城市入场、返回窗前、孩子翻书与思考，直至出现下一个热点，窗内的原版城市背景和孩子逐帧图像均已显示。src/engine/model/links.js 和 check-links.mjs 恢复了 OVER/UNDER 捕获、分离和合法叠合；src/engine/model/holes.js 按原版条件解析孔洞下层候选。游戏输入已接入 LinkModel.release/place，存档新增 captureSides，并在无过渡、无未完成动画的稳定帧保存到浏览器本地。

## 2026-11-10 棋盘、检查点与声音

| 文件 | 变化 |
|---|---|
| src/game/runtime.js、src/engine/model/board.js | 按剧情结束状态展开四格；原版棋盘尺寸、方向按钮、取放落点、叠合与分离；拖动取消后归位；不再等待已不可见的动画层 |
| src/engine/render/renderer.js | 在绘制前收集嵌套纹理，使用同一份场景报告绘制；恢复相对图形的多边形裁切 |
| src/engine/model/state.js、src/engine/model/storage.js | 用原版 onGridOnly 门控；保存剧情阶段并兼容旧存档；检查点恢复真实叠层 |
| src/engine/model/project.js、tools/extract/prepare-runtime.ps1、public/assets/data/runtime-*.json | 导入五章与尾声检查点，原版选中卡及 OVER/UNDER 关系 |
| src/engine/audio/audio.js、src/engine/audio/soundtrack.js、public/assets/audio/ | 原声环境、动画、界面音，291 个重封装 Ogg、755 条事件 |
| tools/checks/check-prologue.mjs | 用真实游戏入口回归城市、书和碗、拆卡、屋顶叠合、树枝与碗对齐、拾取第一颗果实和保存 |

## 2026-11-11 完整通关、结局与片尾

| 文件 | 变化 |
|---|---|
| src/engine/model/state.js、tools/checks/check-state.mjs | 失效谓词引用回落到所属卡片，恢复第二章拱门叠合；缺省坐标回落到左上格，恢复最后一段回忆 |
| src/game/runtime.js、src/engine/model/board.js | 接入指南针与火焰；还原尾声收盘；让结局与瞳孔转场同步；清理旧热点；支持叠层按原版导航同步切换回忆 |
| src/engine/model/scripts.js、tools/checks/check-scripts.mjs | 还原指南针物理、三组火焰和两处星光脚本。原版导出把指南针的切换节点排在八个方向之后，网页直接写入脚本算出的方向，并在重载后保留锁定方向 |
| src/engine/render/renderer.js、src/engine/animation.js | 接入脚本时长、针与阴影、火焰多边形绘制 |
| src/game/screens/ending.js、index.html、src/styles/game.css | 用四张原版贴图复现结局混合，结局铺满浏览器窗口 |
| src/game/screens/credits.js、public/assets/data/credits.json | 还原八页原版片尾名单、淡入淡出、自动和手动翻页 |
| src/styles/fonts/NotoSerif-Regular.ttf、src/styles/fonts/NotoSerif-Bold.ttf、public/assets/data/NotoSerif-OFL.txt | 原版片尾的 24 号正文与 32 号标题所用字体及随附许可 |
| src/engine/audio/score.js、src/engine/audio/soundtrack.js、src/engine/audio/audio.js | 接入卡片、场景、里程碑配乐及壁炉环境音切换 |
| index.html、src/styles/game.css、src/game/runtime.js | 游戏画面居中，接入原版折纸图标、暂停、声音启用、章节选择及载入确认 |
| tools/checks/check-prologue.mjs | 从开场验证五个正章、五段回忆和自然进入结局，验证暂停和章节解锁、尾声原版检查点与名单翻页，按仓库子路径加载资源 |
| vite.config.js、tools/pages/stage-pages.mjs | 校验并复制正式版图集、界面、音频和数据，保留供本机核对的完整导出 |
| .github/workflows/pages.yml | 手动发布前加入完整通关和尾声检查点校验 |

完整通关回归用模拟时钟和指针驱动游戏入口。内置浏览器中实际确认了窗景、暂停、章节确认、声音启用、继续游戏、结局渲染和片尾翻页。当时未执行构建，也未提交、推送或发布。

## 2026-11-19 Vue、目录与 H5 重构

- 格式化与去重基线单独提交为 `07fb867`，本阶段重构在自动验收后单独提交为 `c636f41`。
- `src/ui/` 使用 Vue SFC 管理设置、章节、语言、制作人员名单和热点；`src/game/` 保留运行时及稳定画面宿主，渲染、音频、模型分别归入 `src/engine/render/`、`audio/`、`model/`。
- `src/i18n/`、`src/resources/` 集中语言与资源辅助逻辑；工具归入 `tools/checks/`、`extract/`、`pages/`，同步入口、导入、字体与工作流路径。
- 游戏和素材核对页样式分别迁移为 `src/styles/game.scss`、`src/inspector/style.scss`；使用 `sass-embedded` 嵌套整理，不增加独立动画库。
- 手机横竖屏采用安全区、动态视口、正方形棋盘和可滚动菜单；普通操作区至少 44 CSS px，保留原谜题热点与逻辑坐标。新增界面过渡支持 reduced-motion。
- 声音在真实手势中、网络请求前解锁；全屏跟随真实 API 状态；统一 Pointer Events，取消手势和失去捕获时恢复拖拽。
- `tests/` 用 Happy DOM 挂载真实 Vue 组件；完整通关、尾声、章节菜单及 9 项界面测试通过，15 项独立检查通过。格式检查和生产构建已执行。
- `check-project.mjs`、`check-cil.mjs`、`check-audio.mjs` 缺少原始导出或原游戏安装文件，未计为通过。
- 发布资源仍为 1036 项、732 张贴图、291 段音频，共 650,245,594 字节；`public/assets` 未修改。
- 无头 Chromium 验收发现装饰边缘伪元素扩大手机布局视口，导致画面裁切和暂停按钮离开可见区域；在 `#app` 边界裁切装饰，保持视口内的原版边缘效果。
- 快速触摸抬起产生 `pointerleave`，原版悬停入场条件在下一帧前被清除；触摸保留最后触及的卡片，鼠标离开仍正常清除。完整通关测试新增无悬停、无中间帧的触摸入场回归。
- 真实触摸拖拽将 Canvas 的隐式捕获转交棋盘时，Canvas 的 `lostpointercapture` 冒泡曾误取消拆卡；现在仅处理棋盘自身失去捕获，继续保留实际取消手势和棋盘失去捕获时的归位。新增捕获转交回归先复现失败，修复后完整通关及 9 项界面测试通过。
- 最终构建通过无头 Chromium 151.0.7922.34 四视口验收：320×568、390×844、844×390、1280×800；实际触摸走序章、拆卡并保存，核对旋转、暂停恢复、18 种语言及 RTL、制作人员名单、真实音频解锁与解码、全屏状态和 reduced-motion。手机/桌面素材核对页、结局 WebGL 及片尾前后翻页通过，截图与结果保留在被忽略的 `work/verification/`。
- 浏览器验收仅排除已知 `favicon.ico` 的 404，未发现其他控制台错误或资源请求失败；未操作用户桌面，未新增浏览器测试依赖。iOS/Android 实机、安全区和真实地址栏变化仍未验证，逐场景音画对照仍待验收。

## 2026-11-19 至 11-20 界面音效、加载优化、动画分层与自动发布

| 文件 | 变化 |
|---|---|
| src/engine/audio/interface.js、src/ui/SettingsPanel.vue、src/ui/useGame.js、tests/interface-audio.test.js | 按原版 Startup 绑定补齐菜单与热点音效：4 个并发音源，每组洗牌后循环，随机音量与音高，调节音量时播放 slide 音效（`2966820`） |
| public/assets/data/runtime-project.json、runtime-manifest.json、tools/extract/prepare-runtime.ps1、tools/checks/check-project.mjs | 运行时逻辑树剔除 `deletionLog`，原始体积由 17.0 MB 降至 13.6 MB，gzip 由 2.66 MB 降至 1.74 MB；`-VerifyOnly` 与原版 XML 逐节点核对一致 |
| src/resources/json.js、src/resources/startup-timing.js、src/engine/model/project.js | 启动数据并行加载；地址带 `?timing` 时输出启动各阶段和 JSON 下载、解析耗时 |
| src/game/runtime.js、src/engine/render/atlas.js、src/engine/render/renderer.js、src/ui/Hotspots.vue | 页面转入后台时冻结时钟并暂停音频；热点悬停、按下或聚焦时按导航目标有限预取图集；移动端画布像素比上限为 2（`8d7679f`） |
| src/i18n/index.js、src/i18n/messages.js、index.html、src/ui/useSettings.js | 游戏名称随语言显示为“画中世界”“畫中世界”或“Gorogoa”；首次运行按浏览器语言偏好选择，已保存的手动设置优先 |
| package.json、pnpm-lock.yaml | 迁移到 pnpm，删除 `package-lock.json`；新增 Anime.js 4.5.0 |
| src/game/motion.js、src/game/timeline.js、src/engine/model/board.js、src/engine/model/navigation.js、tests/motion.test.js | 核心运动收拢为纯采样控制器，直接以 elapsed 调用原版采样函数；Anime.js 只编排启动页和片尾的淡入淡出，由冻结时钟 seek 推进（`610dec6`） |
| src/game/screens/startup.js、src/game/screens/credits.js、tests/ui.test.js | 启动页与片尾改用界面时间线，不再需要显式取消 |
| .github/workflows/pages.yml | 改用 pnpm，增加推送到 `main` 时自动构建部署（`f2bed84`）；修复 Prettier 差异后，`0c6e3d5` 的远端构建与部署成功 |

发布集合仍为 1036 项、732 张贴图、291 段音频；因运行时逻辑树缩小，静态资源降至 646,766,297 字节。
