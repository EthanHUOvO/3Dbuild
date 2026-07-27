import "./restroom.css";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { AssemblyController, type AssemblyState } from "./animation/AssemblyController";
import { ExplosionController } from "./animation/ExplosionController";
import { SelectionManager } from "./interaction/SelectionManager";
import {
  RestroomBuilder,
  type RestroomComponentData,
  type RestroomSupportReport,
  type RestroomVentilationReport,
  type RestroomZone,
} from "./restroom/RestroomBuilder";
import {
  ComponentType,
  TYPE_LABELS,
  type TempleComponentData,
} from "./temple/componentTypes";

const RESTROOM_ORDER: ComponentType[][] = [
  [ComponentType.SIGNAGE, ComponentType.SCREEN],
  [ComponentType.VENTILATION],
  [ComponentType.ROOF_PANEL],
  [ComponentType.FIXTURE],
  [ComponentType.PARTITION],
  [ComponentType.PLUMBING],
  [ComponentType.WALL],
  [ComponentType.FLOOR, ComponentType.FOUNDATION],
];

const RESTROOM_STAGES = [
  "入口屏风与标识",
  "通风设备",
  "屋面模块",
  "卫生洁具",
  "厕位隔断",
  "给排水模块",
  "围护墙体",
  "地坪与基础",
];

const TYPE_ORDER = [
  ComponentType.FOUNDATION,
  ComponentType.FLOOR,
  ComponentType.WALL,
  ComponentType.PARTITION,
  ComponentType.FIXTURE,
  ComponentType.PLUMBING,
  ComponentType.VENTILATION,
  ComponentType.ROOF_PANEL,
  ComponentType.SCREEN,
  ComponentType.SIGNAGE,
];

function element<T extends HTMLElement>(id: string): T {
  const target = document.getElementById(id);
  if (!target) throw new Error(`Required interface element #${id} is missing.`);
  return target as T;
}

const canvas = element<HTMLCanvasElement>("scene-canvas");
const viewport = element<HTMLElement>("viewport");
const slider = element<HTMLInputElement>("explosion-slider");
const loading = element<HTMLElement>("loading");
const toast = element<HTMLElement>("toast");
const stageTrack = element<HTMLElement>("stage-track");
const pauseButton = element<HTMLButtonElement>("pause-resume");

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07100f);
scene.fog = new THREE.FogExp2(0x07100f, 0.025);

const camera = new THREE.PerspectiveCamera(39, 1, 0.1, 120);
const cameraPresets = {
  structure: {
    position: new THREE.Vector3(16.5, 10.8, 18.5),
    target: new THREE.Vector3(0, 1.75, 0),
  },
  exploded: {
    position: new THREE.Vector3(29, 22, 34),
    target: new THREE.Vector3(0, 6.1, 0),
  },
  ventilation: {
    position: new THREE.Vector3(12.8, 15.5, 17.5),
    target: new THREE.Vector3(0, 1.75, -0.5),
  },
} as const;
camera.position.copy(cameraPresets.structure.position);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.14;

const controls = new OrbitControls(camera, canvas);
controls.target.copy(cameraPresets.structure.target);
controls.enableDamping = true;
controls.dampingFactor = 0.065;
controls.minDistance = 7.5;
controls.maxDistance = 72;
controls.maxPolarAngle = Math.PI * 0.49;
controls.screenSpacePanning = false;

scene.add(new THREE.HemisphereLight(0xb8dbd5, 0x17211f, 2.1));
scene.add(new THREE.AmbientLight(0xaac5bf, 0.42));

const keyLight = new THREE.DirectionalLight(0xfff0d6, 5.1);
keyLight.position.set(13, 21, 15);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.left = -24;
keyLight.shadow.camera.right = 24;
keyLight.shadow.camera.top = 24;
keyLight.shadow.camera.bottom = -18;
keyLight.shadow.bias = -0.00028;
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0x62c6ba, 1.75);
fillLight.position.set(-15, 10, -12);
scene.add(fillLight);

const entryLight = new THREE.PointLight(0xe3bd79, 24, 28, 2);
entryLight.position.set(0, 8, 11);
scene.add(entryLight);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(54, 44),
  new THREE.MeshStandardMaterial({ color: 0x101a18, roughness: 0.96, metalness: 0.01 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.23;
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(42, 21, 0x3b6c63, 0x1f3a35);
grid.position.y = -0.2;
const gridMaterial = grid.material as THREE.Material;
gridMaterial.transparent = true;
gridMaterial.opacity = 0.24;
scene.add(grid);

const plaza = new THREE.Mesh(
  new THREE.PlaneGeometry(17, 13),
  new THREE.MeshStandardMaterial({ color: 0x27302d, roughness: 0.93 }),
);
plaza.rotation.x = -Math.PI / 2;
plaza.position.set(0, -0.18, 1.25);
plaza.receiveShadow = true;
scene.add(plaza);

const restroom = new RestroomBuilder().build();
scene.add(restroom.root);
const supportReport = RestroomBuilder.validateSupportPaths(restroom);
const ventilationReport = RestroomBuilder.validateVentilation(restroom);
const programReport = RestroomBuilder.getProgramReport(restroom);

const explosion = new ExplosionController(restroom.components);
const assembly = new AssemblyController(restroom.components, explosion, RESTROOM_ORDER, RESTROOM_STAGES);
const selection = new SelectionManager(canvas, camera, [restroom.root], restroom.components);

let selectedData: RestroomComponentData | null = null;
let toastTimer = 0;
let ventilationMode = false;
let currentCameraPreset: keyof typeof cameraPresets = "structure";
let cameraTween:
  | {
      elapsed: number;
      duration: number;
      fromPosition: THREE.Vector3;
      fromTarget: THREE.Vector3;
      toPosition: THREE.Vector3;
      toTarget: THREE.Vector3;
    }
  | null = null;

const typeVisibility = new Map<ComponentType, boolean>(TYPE_ORDER.map((type) => [type, true]));
const zoneVisibility = new Map<RestroomZone, boolean>([
  ["MALE", true],
  ["FEMALE", true],
  ["SHARED", true],
]);
const typeCheckboxes = new Map<ComponentType, HTMLInputElement>();

function createFilters(): void {
  const host = element<HTMLElement>("type-filters");
  TYPE_ORDER.forEach((type) => {
    const count = restroom.components.filter(({ data }) => data.componentType === type).length;
    if (count === 0) return;
    const typeLabel =
      type === ComponentType.ROOF_PANEL
        ? { zh: "平屋面模块", en: "Flat roof", color: TYPE_LABELS[type].color }
        : TYPE_LABELS[type];
    const label = document.createElement("label");
    label.className = "filter-row";
    label.style.setProperty("--filter-color", typeLabel.color);
    label.innerHTML = `
      <input type="checkbox" checked aria-label="显示或隐藏${typeLabel.zh}" />
      <span class="filter-toggle"><i></i></span>
      <i class="filter-color"></i>
      <span class="filter-name">
        <strong>${typeLabel.zh}</strong>
        <span>${typeLabel.en.toUpperCase()}</span>
      </span>
      <em>${String(count).padStart(2, "0")}</em>
    `;
    const checkbox = label.querySelector("input") as HTMLInputElement;
    checkbox.addEventListener("change", () => {
      typeVisibility.set(type, checkbox.checked);
      applyVisibility();
    });
    typeCheckboxes.set(type, checkbox);
    host.append(label);
  });
}

function createStageTrack(): void {
  RESTROOM_STAGES.forEach((label, index) => {
    const item = document.createElement("span");
    item.textContent = `${index + 1} ${label}`;
    item.title = label;
    stageTrack.append(item);
  });
}

function isVisibleByAnalysis(data: RestroomComponentData): boolean {
  if (!ventilationMode) return true;
  if (data.componentType === ComponentType.VENTILATION || data.componentType === ComponentType.FLOOR) return true;
  return data.componentType === ComponentType.WALL && data.componentId.startsWith("WC-WALL-C-");
}

function applyVisibility(): void {
  restroom.components.forEach(({ object, data }) => {
    const restroomData = data as RestroomComponentData;
    const visible =
      (typeVisibility.get(data.componentType) ?? true) &&
      (zoneVisibility.get(restroomData.zone) ?? true) &&
      isVisibleByAnalysis(restroomData);
    data.baseVisible = visible;
    object.visible = visible;
  });
  updateCounts();
}

function updateCounts(): void {
  const visible = restroom.components.filter(({ object }) => object.visible).length;
  element<HTMLElement>("visible-count").textContent = String(visible);
  element<HTMLElement>("total-count").textContent = String(restroom.components.length);
  element<HTMLElement>("tab-count").textContent = String(restroom.components.length);
}

function reachesFoundation(componentId: string, visiting = new Set<string>()): boolean {
  if (componentId === "WC-FND-01") return true;
  if (visiting.has(componentId)) return false;
  const component = restroom.componentMap.get(componentId);
  if (!component) return false;
  const next = new Set(visiting).add(componentId);
  return component.data.supportedBy.some((supportId) => reachesFoundation(supportId, next));
}

function resolveNames(ids: string[]): string {
  if (ids.length === 0) return "GROUND / 地面";
  return ids
    .slice(0, 5)
    .map((id) => {
      const data = restroom.componentMap.get(id)?.data;
      return data ? `${data.componentNameZh} (${id})` : id;
    })
    .join(" · ");
}

function updateSelection(data: TempleComponentData | null): void {
  selectedData = data as RestroomComponentData | null;
  const empty = element<HTMLElement>("empty-selection");
  const details = element<HTMLElement>("component-details");
  if (!selectedData) {
    empty.classList.remove("hidden");
    details.classList.add("hidden");
    element<HTMLElement>("selection-state").textContent = "0 SELECTED";
    return;
  }

  empty.classList.add("hidden");
  details.classList.remove("hidden");
  element<HTMLElement>("selection-state").textContent = "1 SELECTED";
  element<HTMLElement>("component-type").textContent = selectedData.componentType;
  element<HTMLElement>("component-name").textContent =
    `${selectedData.componentNameZh} · ${selectedData.componentNameEn}`;
  element<HTMLElement>("component-status").textContent = selectedData.status;
  element<HTMLElement>("component-id").textContent = selectedData.componentId;
  element<HTMLElement>("component-zone").textContent =
    selectedData.zone === "MALE" ? "男厕 / MALE" : selectedData.zone === "FEMALE" ? "女厕 / FEMALE" : "共享 / SHARED";
  element<HTMLElement>("component-system").textContent = selectedData.system;
  element<HTMLElement>("component-role").textContent = selectedData.ventilationRole ?? "—";
  element<HTMLElement>("component-layer").textContent =
    `L${String(selectedData.layer).padStart(2, "0")} · STEP ${String(selectedData.assemblyStep).padStart(2, "0")}`;
  element<HTMLElement>("component-position").textContent =
    `${selectedData.originalPosition.x.toFixed(2)}, ${selectedData.originalPosition.y.toFixed(2)}, ${selectedData.originalPosition.z.toFixed(2)}`;
  element<HTMLElement>("supported-by").textContent = resolveNames(selectedData.supportedBy);
  element<HTMLElement>("connected-to").textContent = resolveNames(selectedData.connectedTo);
  const result = element<HTMLElement>("selected-support-result");
  const valid = reachesFoundation(selectedData.componentId);
  result.querySelector("strong")!.textContent = valid ? "PASS" : "INVALID";
  result.classList.toggle("invalid", !valid);
}

function showToast(message: string, variant: "info" | "success" | "warning" = "info"): void {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = `restroom-toast visible ${variant}`;
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 2700);
}

function setCameraPreset(preset: keyof typeof cameraPresets, force = false): void {
  if (!force && currentCameraPreset === preset) return;
  currentCameraPreset = preset;
  const targetPreset = cameraPresets[preset];
  cameraTween = {
    elapsed: 0,
    duration: 1,
    fromPosition: camera.position.clone(),
    fromTarget: controls.target.clone(),
    toPosition: targetPreset.position.clone(),
    toTarget: targetPreset.target.clone(),
  };
}

function updateCameraTween(delta: number): void {
  if (!cameraTween) return;
  cameraTween.elapsed += delta;
  const raw = Math.min(1, cameraTween.elapsed / cameraTween.duration);
  const eased = raw < 0.5 ? 2 * raw * raw : 1 - Math.pow(-2 * raw + 2, 2) / 2;
  camera.position.lerpVectors(cameraTween.fromPosition, cameraTween.toPosition, eased);
  controls.target.lerpVectors(cameraTween.fromTarget, cameraTween.toTarget, eased);
  if (raw >= 1) cameraTween = null;
}

function updateExplosionUi(progress: number): void {
  const percent = Math.round(progress * 100);
  slider.value = String(percent);
  element<HTMLElement>("explosion-value").textContent = `${percent}%`;
  element<HTMLElement>("view-label").textContent = ventilationMode
    ? "通风路径 · AIRFLOW ANALYSIS"
    : percent === 0
      ? "完整建筑 · AXONOMETRIC"
      : percent === 100
        ? "系统爆炸 · EXPLODED"
        : `拆分过程 · ${percent}%`;
  if (assembly.getMode() === "idle") {
    element<HTMLElement>("assembly-state").textContent =
      percent === 0 ? "完整状态" : percent === 100 ? "全部爆炸" : "手动拆分";
    element<HTMLElement>("assembly-step").textContent =
      `STEP ${percent === 0 ? "00" : percent === 100 ? "08" : "--"} / 08`;
  }
}

function updateAssemblyUi(state: AssemblyState): void {
  const labels: Record<string, string> = {
    idle: explosion.getProgress() >= 0.995 ? "全部爆炸" : explosion.getProgress() <= 0.005 ? "完整状态" : "手动拆分",
    disassembling: `正在拆解 · ${state.stageLabel}`,
    assembling: `正在装配 · ${state.stageLabel}`,
    paused: `已暂停 · ${state.stageLabel}`,
  };
  element<HTMLElement>("assembly-state").textContent = labels[state.mode];
  const displayedStep =
    state.mode === "idle"
      ? explosion.getProgress() >= 0.995
        ? RESTROOM_STAGES.length
        : explosion.getProgress() <= 0.005
          ? 0
          : state.stage + 1
      : state.stage + 1;
  element<HTMLElement>("assembly-step").textContent =
    `STEP ${String(displayedStep).padStart(2, "0")} / ${String(RESTROOM_STAGES.length).padStart(2, "0")}`;
  pauseButton.textContent = state.mode === "paused" ? "▶" : "Ⅱ";
  pauseButton.classList.toggle("is-paused", state.mode === "paused");
  [...stageTrack.children].forEach((child, index) => {
    child.classList.toggle("active", index === state.stage && state.mode !== "idle");
  });
}

function showAll(): void {
  ventilationMode = false;
  element<HTMLButtonElement>("ventilation-mode").classList.remove("active");
  element<HTMLButtonElement>("ventilation-mode").textContent = "通风分析";
  typeVisibility.forEach((_, type) => typeVisibility.set(type, true));
  zoneVisibility.forEach((_, zone) => zoneVisibility.set(zone, true));
  typeCheckboxes.forEach((checkbox) => {
    checkbox.checked = true;
  });
  document.querySelectorAll<HTMLInputElement>("[data-zone]").forEach((checkbox) => {
    checkbox.checked = true;
  });
  applyVisibility();
  updateExplosionUi(explosion.getProgress());
}

function resetModel(): void {
  assembly.stop();
  selection.clear();
  showAll();
  explosion.setProgress(0);
  const driftFree = explosion.verifyNoDrift();
  document.documentElement.dataset.positionDriftFree = String(driftFree);
  setCameraPreset("structure", true);
  showToast(
    driftFree
      ? `公共厕所已复原；${restroom.components.length} 个构件原始坐标校验通过`
      : "模型已复原，但发现构件坐标异常",
    driftFree ? "success" : "warning",
  );
}

slider.addEventListener("input", () => {
  assembly.stop();
  const progress = Number(slider.value) / 100;
  explosion.setProgress(progress);
  if (!ventilationMode && progress >= 0.48) setCameraPreset("exploded");
  if (!ventilationMode && progress <= 0.12) setCameraPreset("structure");
});

element<HTMLButtonElement>("complete-state").addEventListener("click", () => {
  assembly.stop();
  explosion.animateTo(0, 1.05);
  if (!ventilationMode) setCameraPreset("structure");
  showToast("正在恢复完整公共厕所");
});

element<HTMLButtonElement>("full-explode").addEventListener("click", () => {
  assembly.stop();
  explosion.animateTo(1, 1.3);
  setCameraPreset("exploded");
  showToast(`正在展开 ${restroom.components.length} 个建筑与设备模块`);
});

element<HTMLButtonElement>("auto-disassemble").addEventListener("click", () => {
  assembly.startDisassembly();
  setCameraPreset("exploded");
  showToast("自动拆解已开始：从入口、通风与屋面逐级向基础推进");
});

element<HTMLButtonElement>("auto-assemble").addEventListener("click", () => {
  assembly.startAssembly();
  setCameraPreset("exploded");
  showToast("自动装配已开始：从基础、墙体和设备向入口标识推进");
});

pauseButton.addEventListener("click", () => {
  const mode = assembly.togglePause();
  if (mode === "idle") showToast("当前没有正在运行的顺序动画", "warning");
});

element<HTMLButtonElement>("ventilation-mode").addEventListener("click", () => {
  ventilationMode = !ventilationMode;
  assembly.stop();
  if (ventilationMode) explosion.animateTo(0, 0.62);
  const button = element<HTMLButtonElement>("ventilation-mode");
  button.classList.toggle("active", ventilationMode);
  button.textContent = ventilationMode ? "返回整体" : "通风分析";
  applyVisibility();
  updateExplosionUi(explosion.getProgress());
  setCameraPreset(ventilationMode ? "ventilation" : explosion.getProgress() > 0.42 ? "exploded" : "structure", true);
  showToast(
    ventilationMode
      ? `通风路径已突出显示：${ventilationReport.valid}/${ventilationReport.total} 个分区有效`
      : "已返回整体建筑显示",
    "success",
  );
});

document.querySelectorAll<HTMLInputElement>("[data-zone]").forEach((checkbox) => {
  checkbox.addEventListener("change", () => {
    zoneVisibility.set(checkbox.dataset.zone as RestroomZone, checkbox.checked);
    applyVisibility();
  });
});

element<HTMLButtonElement>("show-all").addEventListener("click", () => {
  showAll();
  showToast("全部构件类别和使用分区已恢复");
});

element<HTMLButtonElement>("reset-model").addEventListener("click", resetModel);
element<HTMLButtonElement>("reset-camera").addEventListener("click", () => {
  const preset = ventilationMode ? "ventilation" : explosion.getProgress() > 0.42 ? "exploded" : "structure";
  setCameraPreset(preset, true);
  showToast("镜头正在返回分析观察位");
});
element<HTMLButtonElement>("toggle-grid").addEventListener("click", () => {
  grid.visible = !grid.visible;
  showToast(grid.visible ? "分析网格已显示" : "分析网格已隐藏");
});

element<HTMLButtonElement>("isolate-layer").addEventListener("click", () => {
  if (!selectedData) return;
  ventilationMode = false;
  restroom.components.forEach(({ object, data }) => {
    object.visible = data.layer === selectedData!.layer;
    data.baseVisible = object.visible;
  });
  updateCounts();
  showToast(`已隔离显示装配层 L${String(selectedData.layer).padStart(2, "0")}`);
});

const help = element<HTMLElement>("help-panel");
element<HTMLButtonElement>("help-button").addEventListener("click", () => help.classList.toggle("hidden"));
element<HTMLButtonElement>("close-help").addEventListener("click", () => help.classList.add("hidden"));

selection.setSelectionCallback(updateSelection);
explosion.setProgressCallback(updateExplosionUi);
assembly.setStateCallback(updateAssemblyUi);

createFilters();
createStageTrack();
updateCounts();

element<HTMLElement>("support-count").textContent = `${supportReport.valid} / ${supportReport.total}`;
element<HTMLElement>("support-note").textContent =
  supportReport.invalidIds.length === 0 ? "全部模块均可沿 supportedBy 关系回溯至整体基础" : "发现支撑路径异常";
ventilationReport.zones.forEach((zone) => {
  element<HTMLElement>(zone.zone === "MALE" ? "male-vent-status" : "female-vent-status").textContent = zone.status;
});
element<HTMLElement>("ventilation-note").textContent =
  ventilationReport.valid === ventilationReport.total
    ? `${ventilationReport.valid} / ${ventilationReport.total} 分区的补风—排风语义路径有效`
    : "至少一个分区缺少连续通风路径";
element<HTMLElement>("male-wc-count").textContent = String(programReport.maleToilets);
element<HTMLElement>("male-urinal-count").textContent = String(programReport.maleUrinals);
element<HTMLElement>("female-wc-count").textContent = String(programReport.femaleToilets);
element<HTMLElement>("basin-count").textContent = String(programReport.maleBasins + programReport.femaleBasins);

function resize(): void {
  const width = Math.max(1, viewport.clientWidth);
  const height = Math.max(1, viewport.clientHeight);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

const resizeObserver = new ResizeObserver(resize);
resizeObserver.observe(viewport);
resize();

const clock = new THREE.Clock();
function render(): void {
  requestAnimationFrame(render);
  const delta = clock.getDelta();
  explosion.update(delta);
  assembly.update(delta);
  updateCameraTween(delta);
  controls.update();
  renderer.render(scene, camera);
}
render();

window.setTimeout(() => {
  loading.classList.add("is-hidden");
  showToast(
    `生成完成：${restroom.components.length} 个模块，男女分区与 ${ventilationReport.valid} 条通风路径通过校验`,
    "success",
  );
}, 560);

window.addEventListener("error", (event) => {
  document.documentElement.dataset.runtimeError = event.message;
  showToast(`运行错误：${event.message}`, "warning");
});

interface RestroomTestApi {
  componentCount: number;
  getSupportReport(): RestroomSupportReport;
  getVentilationReport(): RestroomVentilationReport;
  getProgramReport(): typeof programReport;
  setExplosion(value: number): void;
  getExplosion(): number;
  autoDisassemble(): void;
  autoAssemble(): void;
  getAssemblyMode(): string;
  setVentilationAnalysis(active: boolean): void;
  isVentilationAnalysis(): boolean;
  verifyNoDrift(): boolean;
  resetModel(): void;
}

declare global {
  interface Window {
    __restroomDemo: RestroomTestApi;
  }
}

window.__restroomDemo = {
  componentCount: restroom.components.length,
  getSupportReport: () => ({ ...supportReport, invalidIds: [...supportReport.invalidIds] }),
  getVentilationReport: () => ({
    ...ventilationReport,
    zones: ventilationReport.zones.map((zone) => ({
      ...zone,
      intakeIds: [...zone.intakeIds],
      outletIds: [...zone.outletIds],
      path: [...zone.path],
    })),
  }),
  getProgramReport: () => ({ ...programReport }),
  setExplosion: (value) => {
    assembly.stop();
    explosion.setProgress(value);
  },
  getExplosion: () => explosion.getProgress(),
  autoDisassemble: () => assembly.startDisassembly(),
  autoAssemble: () => assembly.startAssembly(),
  getAssemblyMode: () => assembly.getMode(),
  setVentilationAnalysis: (active) => {
    if (ventilationMode !== active) element<HTMLButtonElement>("ventilation-mode").click();
  },
  isVentilationAnalysis: () => ventilationMode,
  verifyNoDrift: () => explosion.verifyNoDrift(),
  resetModel,
};

document.documentElement.dataset.modelComponentCount = String(restroom.components.length);
document.documentElement.dataset.supportPathsValid = String(supportReport.invalidIds.length === 0);
document.documentElement.dataset.ventilationPathsValid = String(
  ventilationReport.valid === ventilationReport.total,
);
document.documentElement.dataset.zonesSeparated = String(programReport.separatedZones);
document.documentElement.dataset.positionDriftFree = String(explosion.verifyNoDrift());
document.documentElement.dataset.runtimeReady = "true";
