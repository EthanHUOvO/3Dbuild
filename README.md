# Modular Heritage Assembly

这是一个无需后端的交互式 3D 研究演示系统。它以程序化几何体提供四种不同用途的模块化建筑模型：

- `/`：具有五开间、三进深视觉特征的简化木构大殿，252 个可操作构件，包含结构缺陷与修复案例。
- `/pavilion.html`：简化八角凉亭，91 个可操作构件，重点展示清晰的支撑链、爆炸分层与重组过程。
- `/restroom.html`：现代极简公共厕所，88 个可操作模块，展示男女独立分区、入口视线遮挡、卫生洁具、给排水与混合通风路径。
- `/worker-room.html`：6.0 m × 3.6 m 简易工人样板间，16 个可操作构件，展示模块化外壳、生活设施、六阶段爆炸装配与排产任务。

> 大殿与凉亭为中国古建筑意象的程序化抽象演示，不代表任何真实文物、遗址或历史建筑的精确复原，也不提供结构力学结论。公共厕所模型用于空间与装配逻辑演示，不代表已通过某个地区的建筑规范审查。

## 技术栈

- Vite
- TypeScript
- Three.js
- Three.js `OrbitControls`
- 原生 HTML 与 CSS
- Cloudflare Vite 插件（仅用于静态站点发布）

运行时不依赖后端、数据库、在线模型、网络图片或在线纹理。四个模型全部由 Three.js 几何体在浏览器内程序化生成。

## 安装与运行

环境要求：Node.js 20 或更高版本。

```bash
npm install
npm run dev
```

开发服务器默认地址：

```text
http://127.0.0.1:5173/
http://127.0.0.1:5173/pavilion.html
http://127.0.0.1:5173/restroom.html
http://127.0.0.1:5173/worker-room.html
```

## 类型检查与生产构建

```bash
npm run typecheck
npm run build
```

生产预览：

```bash
npm run preview
```

默认预览地址：

```text
http://127.0.0.1:4173/
http://127.0.0.1:4173/pavilion.html
http://127.0.0.1:4173/restroom.html
http://127.0.0.1:4173/worker-room.html
```

## 主要交互

- 左键拖动：旋转视角
- 滚轮：缩放
- 右键拖动：平移
- 悬停构件：青色高亮
- 单击构件：金色选中并查看语义属性
- 单击空白：取消选择
- 左侧图层：按构件类别显示或隐藏
- “只查看所选构件层”：隔离当前构件的装配层级
- 底部滑块：设置 0–100% 爆炸程度
- “自动拆解”：按屋脊/屋面 → 椽子 → 檩条 → 斗拱 → 梁架 → 柱网 → 柱础 → 台基执行
- “自动装配”：按上述顺序的反向执行
- “暂停/继续”：控制顺序动画
- “完整状态”“全部爆炸”：执行平滑整体过渡
- “重置视角”：返回当前完整/爆炸状态对应的轴测观察位
- “重置模型”：恢复坐标、图层、选中项、修复状态和镜头

八角凉亭页面采用同一套选择、筛选、爆炸和顺序装配交互。左侧“受力传递”面板会校验每个构件的 `supportedBy` 数据能否逐级回溯至台基；单击任意构件后，右侧可查看它的直接支撑来源和连接节点。

凉亭页面还提供一套可下载的 CAD 图纸：

- `pavilion_plan_A101.dxf`：柱网、圈梁、对角梁、栏杆、放射椽和屋面投影平面图；
- `pavilion_front_elevation_A201.dxf`：正立面图；
- `pavilion_section_AA_A301.dxf`：穿过对向柱和中央雷公柱的中心剖面；
- `pavilion_exploded_A401.dxf`：按支撑和装配顺序绘制的爆炸轴测图；
- `pavilion_drawing_set.dxf`：四张图纸合并在同一模型空间；
- `pavilion_component_schedule.csv`：91 个语义构件明细表；
- `pavilion_drawing_set.svg`：浏览器图纸总览；
- `pavilion_cad_package.zip`：完整下载包。

DXF 采用毫米单位、模型空间 1:1，使用基础 LINE、CIRCLE 和 TEXT 实体以提高 AutoCAD、Rhino、BricsCAD 等软件的兼容性，建议按 A3 / 1:50 出图。重新生成命令：

```bash
npm run export:cad
```

导出尺寸直接来源于程序化凉亭参数：柱网半径 4750 mm、屋檐半径 6650 mm、檐檩标高 8500 mm、屋顶顶点标高 10650 mm。图纸是概念结构演示，不是测绘图、结构计算书或施工图。

### STL 网格导出

凉亭页面同时提供毫米制 STL 下载包：

- `pavilion_complete_assembled_mm.stl`：完整装配状态；
- `pavilion_complete_exploded_mm.stl`：完整爆炸状态；
- `systems/*.stl`：基础、柱础、柱、梁、斗拱、檐檩、椽、屋面、屋脊和栏杆 10 个系统分组；
- `components/*.stl`：91 个独立构件；
- `pavilion_stl_manifest.json`：构件编号、类型、装配/爆炸坐标、三角面数量和包围尺寸；
- `pavilion_stl_package_mm.zip`：完整 STL 下载包。

STL 文件为二进制格式，共 103 个网格文件。完整装配模型包含 4076 个三角面，包围尺寸约为 13385 × 13385 × 12990 mm。由于 STL 不保存单位，导入 Rhino、AutoCAD、Blender 或切片软件时必须选择毫米。程序化屋面原本为单层三角面，STL 导出时会自动加厚为 90 mm 的闭合三角棱柱。

重新生成命令：

```bash
npm run export:stl
```

导出脚本直接加载现有 `PavilionBuilder`，因此 STL 与浏览器中的凉亭构件编号、位置和尺寸保持一致。

#### 最高 40 cm 等比例版本

`public/stl-40cm/` 提供按完整装配高度缩放后的独立下载包：

- `pavilion_complete_assembled_h40cm_mm.stl`：底面位于 Y=0、最高点位于 Y=400 mm；
- `pavilion_complete_exploded_h40cm_mm.stl`：采用相同缩放系数的爆炸状态；
- `systems/*.stl`：10 个等比例系统分组；
- `components/*.stl`：91 个等比例独立构件；
- `pavilion_stl_package_h40cm_mm.zip`：上述文件、清单与导入说明的完整压缩包。

缩放系数为 `0.030792918`，约等于原模型的 `1:32.475`。完整装配包围尺寸约为 `412.166 × 412.166 × 400 mm`，即 `41.22 × 41.22 × 40 cm`。X、Y、Z 三个方向使用同一个缩放系数，没有改变构件比例或相对位置。缩放后屋面实体厚度约为 `2.771 mm`。

STL 本身不记录单位。40 cm 版本的坐标仍使用毫米表达，因此导入 Rhino 或切片软件时应选择毫米；此时模型高度会正确显示为 400 mm。

现代公共厕所页面另外提供：

- 男厕、女厕和共享结构三类分区筛选；
- 男女独立入口、入口折返屏风和连续实体分隔墙；
- 男厕 3 个坐便器、3 个小便器、3 个洗手盆；
- 女厕 5 个坐便器、3 个洗手盆；
- 两侧独立的低位补风格栅、高位自然排风百叶、机械排风机、竖向风管和屋顶风帽；
- “通风分析”视图，突出数据结构中的补风—室内流动—机械排风—屋顶排出路径；
- 88 个模块的类别筛选、单件选择、连续爆炸、自动拆解和自动装配。

通风查询与构件支撑查询均由 `connectedTo`、`supportedBy`、`zone`、`system` 和 `ventilationRole` 数据驱动。它们用于设计演示，不替代真实通风计算、设备选型或规范审查。

## 结构缺陷与修复

顶部切换到“结构缺陷与修复”模式后可使用两个预设案例：

1. 案例 A：缺失斗拱。查询状态由 `UNKNOWN` 在回装后变为 `REPAIRED`。
2. 案例 B：缺失横梁。查询状态由 `INVALID` 在回装后变为 `REPAIRED`。

候选构件以半透明青色显示。点击“应用候选修复”后，候选构件从爆炸位置移动到原始坐标；目标构件状态、依赖构件状态和支撑路径查询都由同一语义数据结构更新。每个案例都可以单独重置并重复执行。

## 模型与语义数据

当前版本生成 252 个可独立操作的构件，包含：

- 石质台基与踏步
- 柱础
- 24 根木柱
- 横向额枋与纵向梁架
- 24 组简化斗拱
- 檩条与椽子
- 72 块程序化曲面屋面板
- 正脊与简化垂脊
- 门窗与围护板

每个构件都保存稳定编号、中英文名称、类别、层级、装配步骤、原始/爆炸坐标、父节点、连接关系、支撑关系和状态。所有爆炸与复原都从原始坐标重新插值，不在当前位置累计位移。

八角凉亭页面另外生成 91 个独立构件：

- 3 层八角石台基
- 8 个柱础与 8 根檐柱
- 8 段圈梁与 4 根对角承托梁
- 8 组简化斗拱与 1 根中央雷公柱
- 8 段压在斗拱上的八角檐檩
- 16 根放射椽、8 片攒尖屋面与 8 条垂脊
- 8 面栏杆与 3 件宝顶构件

其支撑链为“台基 → 柱础 → 檐柱 → 圈梁/对角梁 → 斗拱 → 檐檩 → 放射椽 → 屋面 → 垂脊/宝顶”，雷公柱则由对角梁承托并连接椽子内端。除接地台基外，每个构件都至少保存一个有效支撑节点。

现代公共厕所页面生成 88 个独立模块，包括整体基础、左右地坪、18 段墙体、18 件厕位隔断、17 件卫生洁具、4 件给排水模块、20 件通风构件、2 片屋面、4 件入口屏风和 2 件导视标识。男女两侧都保存一条可查询的“低位进风 → 转移路径 → 高位排风机 → 竖管 → 屋顶风帽”连接链；全部模块都可沿 `supportedBy` 关系回溯至整体基础。

## 项目结构

```text
src/
  animation/
    AssemblyController.ts
    ExplosionController.ts
  interaction/
    SelectionManager.ts
  repair/
    RepairScenarioManager.ts
  temple/
    componentTypes.ts
    TempleBuilder.ts
  pavilion/
    PavilionBuilder.ts
  restroom/
    RestroomBuilder.ts
  ui/
    UIController.ts
  main.ts
  pavilionMain.ts
  pavilion.css
  restroomMain.ts
  restroom.css
  styles.css
scripts/
  exportPavilionCad.mjs
  exportPavilionStl.mjs
worker/
  index.ts
index.html
pavilion.html
restroom.html
vite.config.ts
```

## 替换为真实 GLB 或 IFC 模型

### GLB / glTF

1. 将授权使用的 `.glb` 文件放入 `public/models/`。
2. 使用 Three.js `GLTFLoader` 加载模型。
3. 保留现有 `TempleModel` 和 `TempleComponentData` 接口。
4. 为每个可操作节点建立从 GLB 节点名到 `componentId` 的稳定映射。
5. 在加载完成后记录每个节点的原始位置，并为其计算爆炸位置。
6. 把真实构件的父子、连接和支撑信息写入 `parentIds`、`connectedTo` 和 `supportedBy`。
7. 用加载结果替换 `TempleBuilder.build()`、`PavilionBuilder.build()` 或 `RestroomBuilder.build()` 返回的程序化对象，其余选择、动画和筛选控制器可以继续复用。

### IFC

浏览器端可引入 `web-ifc` 或 IFC.js 读取 IFC，但这会显著增加包体积。建议在离线预处理阶段将 IFC 构件转换为 GLB，并同时导出一份以 GlobalId 为键的 JSON 语义映射。运行时加载 GLB + JSON，可以保持当前系统的轻量和离线特性。无论采用哪种方式，都应对模型来源、授权、坐标系、单位和语义映射做独立校验。

## 当前限制

- 支撑路径查询是数据结构驱动的语义连通性演示，不是有限元或真实结构力学分析。
- 公共厕所通风路径是语义连通性演示，不包含风量、换气次数、噪声、气流组织 CFD 或污染物扩散计算。
- 公共厕所的厕位数量、通道、无障碍、消防和机电表达为概念设计，实际项目必须按所在地规范深化。
- 斗拱、瓦面和屋脊均为抽象几何，不表达真实营造尺度、做法或年代断代。
- 为保持桌面浏览器流畅，重复构件共享部分几何体，未加入高精度雕饰和瓦件细节。
- 当前界面以 1366×768 及更大的桌面分辨率为主要目标。
