# 分析记录（2026-11-06）

## 原版身份

安装目录：E:\SteamLibrary\steamapps\common\Gorogoa。

Steam appid 557600；本机安装清单 buildid 20230791。安装目录 143 个文件，共 659,687,969 字节。UnityFS 头部引擎版本 2017.4.1f1，序列化文件格式 17。

主程序集 SHA-256：6dab4e7729eb8285291e8f980c0c3e57b0caf5cd4aeedfaab4c1f2edd71dc250。

正式项目 XML SHA-256：d47e2b65c4732467963f4334b86ee6a203ff0fb431b82f0e58e111de85c04c2a。

## REA 直接证据

- `ev_c9b87ecd870cae6840854ff57e4e314144781610d6509850b0ccd438c90900c5`：inspect_managed_artifact；确认 Unity Mono / CIL，元数据可识别。TypeDef 566、MethodDef 3861、Field 3246。此调用不执行目标、不反编译 C#。
- `ev_fc06a7235c77b80b83d8072f12c5da233b77594446a402b6962b9a988c9d0754`：inspect_managed_members；成员表示超过工具 64 MiB 预算，coverage 为 unavailable。不是游戏损坏，也不能宣称 REA 成功恢复了方法体。
- 完整原始记录保存于 docs/evidence/rea-session.json。

## 独立只读解析（不冒充 REA 结果）

为继续分析，项目内实现了无额外依赖的 Node 解析工具。它们只读取原文件，将派生文件写入本项目。

- PE/CLI 元数据目录解析到 566 个类型、3861 个方法和 3246 个字段的名称/坐标；尚未反编译和验证其控制流。
- data.unity3d 为 497,707,834 字节，成功按块展开为 1,595,251,668 字节。包含 globalgamemanagers、unity_builtin_extra、globalgamemanagers.assets、sharedassets0.assets、level0、resources.assets 六个成员。
- 所有被读取序列化文件均无类型树；不能用通用字段描述直接恢复每个 MonoBehaviour。
- 清点到 883 个 Texture2D、236 个 TextAsset、291 个 AudioClip。音频这里只清点类型，并未解码。
- 872 个纹理对象成功生成 PNG，其余 11 个对象名为 Font Texture，尺寸为零，记录为 runtime-font，不伪造图像数据。
- 236 个文本资源已恢复。其中正式版 Gorogoa.project 为 15,407,945 字节，是 XML；包含场景、状态、条件、图形、声音配置及动画关键帧。
- ResourceManager 的第一组容器映射解析到 2100 条路径引用；只解析了容器映射，没有宣称完整解析该对象剩余数据。正式版与演示版同名纹理经资源路径区分。
- 建立正式版画面与动画共 6238 个图集区域，所有区域均找到对应 PNG。最初只统计静态图集时为 1128 个，已扩展到动画图集。
- 静态图集中有 72 处裁切宽高加偏移比原画尺寸多 1～3 像素，裁切宽高均为 4 的倍数。观察与压缩块对齐一致；保留原数据，显示时由原始画布尺寸裁切，不擅自缩放。此解释属于推断，仍需与游戏渲染核对。

## 已执行的验证

BC1 单色和透明模式、BC3 alpha、边缘尺寸、截断输入检查通过。872 张 PNG 的签名和尺寸通过；6238 个图集区域的来源和边界检查通过；正式版示例图集 PNG 解压和行长度检查通过。已视觉查看正式版 card002.0 图集，内容能辨认为原版城市、屋顶、碗与生物等分层素材。

这些检查证明解析与图片输出在已检查范围内自洽，**不证明完整游戏逻辑等价，也不证明逐像素渲染一致**。

## 尚未解决

- 原版 C# 方法体的高层逻辑恢复；REA 深入成员解析的工具限制仍存在。
- 第一场景的完整合成、相机与坐标语义。
- 状态更新顺序、堆叠和拼接规则、动画中断、三个自定义脚本的实际行为。
- 音频格式、外部流和播放事件，存档格式迁移。
- 原游戏运行截图与操作轨迹、网页完整通关、浏览器差异。
- GitHub Pages 资源体积和实际部署；未构建、未提交、未推送、未发布。
- 无法读取用户订阅额度的实际百分比；不得把本次工作换算成已经测得的总额度预算。

## 参考格式与发布说明

解析工具为针对本机文件独立编写的受限实现；核对格式时参考了以下上游实现，未安装其依赖：

- https://github.com/K0lb3/UnityPy/blob/master/UnityPy/files/BundleFile.py
- https://github.com/K0lb3/UnityPy/blob/master/UnityPy/files/SerializedFile.py
- https://github.com/Perfare/AssetStudio/blob/master/AssetStudio/Classes/Texture2D.cs
- https://github.com/Perfare/AssetStudio/blob/master/AssetStudio/Classes/Texture.cs
- https://github.com/Perfare/AssetStudio/blob/master/AssetStudio/Classes/TextAsset.cs
- https://vite.dev/guide/
- https://vite.dev/guide/static-deploy

## 素材核对页面验证补记

已通过本机静态服务在浏览器打开核对页，成功显示 872 张图片、6238 个区域和搜索结果，并视觉核对原版生物分层素材的透明度、内容和方向。此验证没有运行 Vite 构建。

图集 XML 的 u/v 使用原纹理的左下角坐标，PNG/Canvas 使用左上角。正式版 sky1 的区域坐标与导出图集的天空位置相互吻合，预览按 `imageHeight - v - h` 转换源区域，并按原始画布尺寸换算纵向裁切偏移。偏移和压缩块补边仍需在完整场景合成时进一步与原版对照。


2026-11-07 音频补记：清点数量更正为291个AudioClip（32+18+241），全部为FSB5 Vorbis。已在本机原版UnityPlayer.dll静态字节找到两个setup ID对应setup包，6个立体声样本无重编码重封装为Ogg。内置浏览器实际AudioContext.decodeAudioData均通过：原声道2；WebAudio上下文重采样48k；时长误差<0.00002秒；开场环境音74.04695833秒。此结果仅覆盖6个样本，不提前声称全291个可播。其它音效和原版事件触发仍继续恢复。

2026-11-10：291 个音源均已重封装并通过 Ogg 结构校验，755 条原事件均有对应音源。历史内置浏览器已实际解码 10 个样本（7 立体声、3 单声道）；其余仅通过结构验证。独立音效测试覆盖开场/窗前轨道共用、拾放音效原顺序和动画音效四路上限。棋盘和可见图层逻辑按本机原版 CIL 中 PlayingGridLayout、GridViewerPanel、CardViewer 和 CardStateManager 的调用恢复，原版数据驱动的回归已验证第一颗果实拾取。8 个导航仍引用缺失的目标 GUID，2 个图层原图引用未找到；不把它们替换成猜测的素材或剧情。
