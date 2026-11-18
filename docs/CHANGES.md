# 本阶段新增文件说明

本阶段所有文件均位于 D:\jinhuan\gorogoa-web；不修改原游戏和其他项目。

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
| src/main.js | 图片/区域切换、搜索、异步图片加载和原始尺寸裁切预览 |
| src/style.css | 核对页布局、透明背景和窄屏适配 |
| tools/inspect-game.mjs | 受限 UnityFS/LZ4、序列化对象及 PE 元数据只读解析 |
| tools/export-resources.mjs | 导出文本、纹理解析与无损 PNG 输出 |
| tools/texture-codecs.mjs | 原生 BC1/BC3 像素解码，不增加依赖 |
| tools/check-texture-codecs.mjs | 解码语义与截断输入校验 |
| tools/map-resources.mjs | 解析正式版/演示版资源路径与对象引用 |
| tools/prepare-data.ps1 | 关联正式版静态/动画图集，生成项目统计和网页数据 |
| tools/check-assets.mjs | PNG、裁切范围、引用和抽样解压校验 |
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

src/engine 和 src/chapters 目录已预留，没有写入未经验证的游戏逻辑。

补充：`work/serve.mjs` 是本机只读静态预览服务，仅监听 127.0.0.1:4178，不构建、不编译，也不访问项目外文件。

# 2026-11-07 连续移植进展

新增：src/engine/project.js（原版逻辑树索引）、camera.js（原版相机/视差）、atlas.js（图集与原图裁切）、renderer.js（实际场景合成）、animation.js（播放列表/关键帧/插值）、state.js（初始状态、谓词、转移和动画门控）、storage.js（完整进度快照与校验）。新增src/game.js和game.css为真实游戏入口；index.html切换为游戏，旧素材工具移为assets.html。

新增分析/测试：tools/prepare-runtime.ps1、inspect-cil.mjs、check-cil.mjs、check-project.mjs、check-camera.mjs、check-renderer.mjs、check-animation.mjs、check-state.mjs、check-storage.mjs，以及runtime-project/runtime-chapter1-save/runtime-manifest派生数据。章节1存档明确为检查点，未误当新游戏起点。

已按真实XML逐元素/属性/顺序核对116066个元素、358627个属性。已修复PowerShell的XML name属性遮蔽标签、CIL非有限数丢失、OffsetViewpoint收缩公式、动画激活时钟、动画可打断候选顺序、自循环重激活和hover热点缓存。

内置浏览器已看到原版城市合成与10部件角色动画，并实际点击返回到window位置。窗前linked场景、翻书sprite序列及卡片捕获继续实现，尚不能声称第一关已通关。全部检查均未执行build/编译；未Git提交、推送或发布。

游戏入口进展补记：已在内置浏览器实际走通城市入场、返回窗前、孩子翻书与思考、出现下一热点；窗内原版城市背景及孩子逐帧图像已显示。src/engine/links.js和check-links.mjs恢复OVER/UNDER捕获、分离和合法叠合。src/engine/holes.js按原版条件解析孔洞下层候选。Game输入已接LinkModel.release/place，存档新增captureSides并接浏览器本地保存（仅在无过渡/无未完动画的稳定帧保存）。完整通关与声音仍未完成，尚不能声称原版一致。

# 2026-11-10 连续移植进展

| 文件 | 变化 |
|---|---|
| src/game.js、src/engine/board.js | 按剧情结束状态展开四格；原版棋盘尺寸、方向按钮、取放落点、叠合与分离；拖动取消后归位；不再等待已不可见的动画层 |
| src/engine/renderer.js | 在绘制前收集嵌套纹理，使用同一份场景报告绘制；恢复相对图形的多边形裁切 |
| src/engine/state.js、src/engine/storage.js | 用原版 onGridOnly 门控；保存剧情阶段并兼容旧存档；检查点恢复真实叠层 |
| src/engine/project.js、tools/prepare-runtime.ps1、public/assets/data/runtime-*.json | 导入五章与尾声检查点，原版选中卡及 OVER/UNDER 关系 |
| src/engine/audio.js、src/engine/soundtrack.js、public/assets/audio/ | 原声环境、动画、界面音，291 个重封装 Ogg、755 条事件 |
| tools/check-prologue.mjs | 用真实游戏入口回归城市、书和碗、拆卡、屋顶叠合、树枝与碗对齐、拾取第一颗果实和保存 |

## 2026-11-11

| 文件 | 变化 |
|---|---|
| src/engine/state.js、tools/check-state.mjs | 失效谓词引用回落到所属卡片，恢复第二章拱门叠合；缺省坐标回落到左上格，恢复最后一段回忆 |
| src/game.js、src/engine/board.js | 接入指南针与火焰；还原尾声收盘；让结局与瞳孔转场同步；清理旧热点；支持叠层按原版导航同步切换回忆 |
| src/engine/scripts.js、tools/check-scripts.mjs | 还原指南针物理、三组火焰和两处星光脚本。原版导出把指南针的切换节点排在八个方向之后，网页直接写入脚本算出的方向，并在重载后保留锁定方向 |
| src/engine/renderer.js、src/engine/animation.js | 接入脚本时长、针与阴影、火焰多边形绘制 |
| src/engine/ending.js、index.html、src/game.css | 用四张原版贴图复现结局混合，结局铺满浏览器窗口 |
| src/engine/credits.js、public/assets/data/credits.json | 还原八页原版片尾名单、淡入淡出、自动和手动翻页 |
| src/engine/NotoSerif-Regular.ttf、src/engine/NotoSerif-Bold.ttf、public/assets/data/NotoSerif-OFL.txt | 原版片尾的 24 号正文与 32 号标题所用字体及随附许可 |
| src/engine/score.js、src/engine/soundtrack.js、src/engine/audio.js | 接入卡片、场景、里程碑配乐及壁炉环境音切换 |
| index.html、src/game.css、src/game.js | 游戏画面居中，接入原版折纸图标、暂停、声音启用、章节选择及载入确认 |
| tools/check-prologue.mjs | 从开场验证五个正章、五段回忆和自然进入结局，验证暂停和章节解锁、尾声原版检查点与名单翻页，按仓库子路径加载资源 |
| vite.config.js、tools/stage-pages.mjs | 校验并复制正式版图集、界面、音频和数据，保留供本机核对的完整导出 |
| .github/workflows/pages.yml | 手动发布前加入完整通关和尾声检查点校验 |

完整通关回归使用模拟时钟与指针驱动游戏入口。内置浏览器实际确认了窗景、暂停、章节确认、声音启用、继续游戏、结局渲染与片尾翻页。未执行构建、编译、Git 提交、推送或发布。
