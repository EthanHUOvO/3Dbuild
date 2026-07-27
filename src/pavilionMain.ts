import "./pavilion.css";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { ExplosionController } from "./animation/ExplosionController";
import { AssemblyController, type AssemblyState } from "./animation/AssemblyController";
import { SelectionManager } from "./interaction/SelectionManager";
import {
  PavilionBuilder,
  type PavilionBearingReport,
  type PavilionSupportReport,
} from "./pavilion/PavilionBuilder";
import {
  ComponentStatus,
  ComponentType,
  STAGE_LABELS,
  TYPE_LABELS,
  type TempleComponentData,
} from "./temple/componentTypes";

function element<T extends HTMLElement>(id: string): T {
  const target = document.getElementById(id);
  if (!target) throw new Error(`Required interface element #${id} is missing.`);
  return target as T;
}

const canvas = element<HTMLCanvasElement>("scene-canvas");
const viewport = element<HTMLElement>("viewport");
const slider = element<HTMLInputElement>("explosion-slider");
const explosionValue = element<HTMLElement>("explosion-value");
const viewLabel = element<HTMLElement>("view-label");
const loading = element<HTMLElement>("loading");
const visibleCount = element<HTMLElement>("visible-count");
const totalCount = element<HTMLElement>("total-count");
const supportCount = element<HTMLElement>("support-count");
const supportNote = element<HTMLElement>("support-note");
const toast = element<HTMLElement>("toast");
const stageTrack = element<HTMLElement>("stage-track");
const assemblyState = element<HTMLElement>("assembly-state");
const assemblyStep = element<HTMLElement>("assembly-step");
const pauseButton = element<HTMLButtonElement>("pause-resume");

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07100f);
scene.fog = new THREE.FogExp2(0x07100f, 0.027);

const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
const structureCamera = new THREE.Vector3(18.5, 13.8, 20.5);
const structureTarget = new THREE.Vector3(0, 5.9, 0);
const explodedCamera = new THREE.Vector3(31, 25, 35);
const explodedTarget = new THREE.Vector3(0, 10.5, 0);
camera.position.copy(structureCamera);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.65));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;

const controls = new OrbitControls(camera, canvas);
controls.target.copy(structureTarget);
controls.enableDamping = true;
controls.dampingFactor = 0.065;
controls.minDistance = 9;
controls.maxDistance = 62;
controls.maxPolarAngle = Math.PI * 0.49;
controls.screenSpacePanning = false;

scene.add(new THREE.HemisphereLight(0xa6d0c8, 0x17211d, 1.7));

const keyLight = new THREE.DirectionalLight(0xffe8c2, 4.2);
keyLight.position.set(15, 24, 13);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.left = -24;
keyLight.shadow.camera.right = 24;
keyLight.shadow.camera.top = 24;
keyLight.shadow.camera.bottom = -18;
keyLight.shadow.bias = -0.00025;
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0x5aaea2, 1.6);
fillLight.position.set(-16, 12, -12);
scene.add(fillLight);

const warmLight = new THREE.PointLight(0xd5a34c, 18, 34, 2);
warmLight.position.set(-9, 12, 10);
scene.add(warmLight);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(31, 72),
  new THREE.MeshStandardMaterial({ color: 0x101b18, roughness: 0.95, metalness: 0.02 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.28;
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(44, 22, 0x345c54, 0x1d3530);
grid.position.y = -0.25;
const gridMaterial = grid.material as THREE.Material;
gridMaterial.transparent = true;
gridMaterial.opacity = 0.3;
scene.add(grid);

const halo = new THREE.Mesh(
  new THREE.RingGeometry(10, 21, 64),
  new THREE.MeshBasicMaterial({
    color: 0x1a3933,
    transparent: true,
    opacity: 0.2,
    side: THREE.DoubleSide,
    depthWrite: false,
  }),
);
halo.rotation.x = -Math.PI / 2;
halo.position.y = -0.2;
scene.add(halo);

const pavilion = new PavilionBuilder().build();
scene.add(pavilion.root);
const supportReport = PavilionBuilder.validateSupportPaths(pavilion);
const bearingReport = PavilionBuilder.validateBearingContacts(pavilion);

const explosion = new ExplosionController(pavilion.components);
const assembly = new AssemblyController(pavilion.components, explosion);
const selection = new SelectionManager(canvas, camera, [pavilion.root], pavilion.components);

let selectedData: TempleComponentData | null = null;
let toastTimer = 0;
let cameraPreset: "structure" | "exploded" = "structure";
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

const typeCheckboxes = new Map<ComponentType, HTMLInputElement>();

function createFilters(): void {
  const host = element<HTMLElement>("type-filters");
  const typeOrder = [
    ComponentType.FOUNDATION,
    ComponentType.COLUMN_BASE,
    ComponentType.COLUMN,
    ComponentType.BEAM,
    ComponentType.DOUGONG,
    ComponentType.PURLIN,
    ComponentType.RAFTER,
    ComponentType.ROOF_PANEL,
    ComponentType.RIDGE,
    ComponentType.ENCLOSURE,
  ];

  typeOrder.forEach((type) => {
    const count = pavilion.components.filter(({ data }) => data.componentType === type).length;
    if (count === 0) return;
    const typeLabel =
      type === ComponentType.ENCLOSURE
        ? { zh: "栏杆围护", en: "Railing", color: TYPE_LABELS[type].color }
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
      pavilion.components.forEach(({ object, data }) => {
        if (data.componentType !== type) return;
        data.baseVisible = checkbox.checked;
        object.visible = checkbox.checked;
      });
      updateCounts();
    });
    typeCheckboxes.set(type, checkbox);
    host.append(label);
  });
}

function createStageTrack(): void {
  STAGE_LABELS.forEach((label, index) => {
    const item = document.createElement("span");
    item.textContent = `${index + 1} ${label}`;
    stageTrack.append(item);
  });
}

function updateCounts(): void {
  const visible = pavilion.components.filter(({ object }) => object.visible).length;
  visibleCount.textContent = String(visible);
  totalCount.textContent = String(pavilion.components.length);
}

function hasGroundPath(componentId: string, visiting = new Set<string>()): boolean {
  if (componentId === "PAV-FND-01") return true;
  if (visiting.has(componentId)) return false;
  const component = pavilion.componentMap.get(componentId);
  if (!component) return false;
  const next = new Set(visiting).add(componentId);
  return component.data.supportedBy.some((supportId) => hasGroundPath(supportId, next));
}

function resolveNames(ids: string[]): string {
  if (ids.length === 0) return "GROUND / 地面";
  return ids
    .map((id) => {
      const data = pavilion.componentMap.get(id)?.data;
      return data ? `${data.componentNameZh} (${id})` : id;
    })
    .join(" · ");
}

function updateSelection(data: TempleComponentData | null): void {
  selectedData = data;
  const empty = element<HTMLElement>("empty-selection");
  const details = element<HTMLElement>("component-details");
  const state = element<HTMLElement>("selection-state");
  if (!data) {
    empty.classList.remove("hidden");
    details.classList.add("hidden");
    state.textContent = "0 SELECTED";
    return;
  }

  empty.classList.add("hidden");
  details.classList.remove("hidden");
  state.textContent = "1 SELECTED";
  element<HTMLElement>("component-type").textContent = data.componentType;
  element<HTMLElement>("component-name").textContent = `${data.componentNameZh} · ${data.componentNameEn}`;
  element<HTMLElement>("component-status").textContent = data.status;
  element<HTMLElement>("component-id").textContent = data.componentId;
  element<HTMLElement>("component-layer").textContent = `L${String(data.layer).padStart(2, "0")}`;
  element<HTMLElement>("component-step").textContent = `STEP ${String(data.assemblyStep).padStart(2, "0")}`;
  element<HTMLElement>("component-position").textContent =
    `${data.originalPosition.x.toFixed(2)}, ${data.originalPosition.y.toFixed(2)}, ${data.originalPosition.z.toFixed(2)}`;
  element<HTMLElement>("supported-by").textContent = resolveNames(data.supportedBy);
  element<HTMLElement>("connected-to").textContent = resolveNames(data.connectedTo);
  const result = element<HTMLElement>("selected-support-result");
  const valid = hasGroundPath(data.componentId);
  result.querySelector("strong")!.textContent = valid ? "PASS" : "INVALID";
  result.classList.toggle("invalid", !valid);
}

function showToast(message: string, variant: "info" | "success" | "warning" = "info"): void {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = `pavilion-toast visible ${variant}`;
  toastTimer = window.setTimeout(() => {
    toast.classList.remove("visible");
  }, 2600);
}

function setCameraPreset(preset: "structure" | "exploded", force = false): void {
  if (!force && cameraPreset === preset) return;
  cameraPreset = preset;
  cameraTween = {
    elapsed: 0,
    duration: 1,
    fromPosition: camera.position.clone(),
    fromTarget: controls.target.clone(),
    toPosition: (preset === "exploded" ? explodedCamera : structureCamera).clone(),
    toTarget: (preset === "exploded" ? explodedTarget : structureTarget).clone(),
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
  explosionValue.textContent = `${percent}%`;
  viewLabel.textContent =
    percent === 0 ? "完整结构 · AXONOMETRIC" : percent === 100 ? "分层爆炸 · EXPLODED" : `拆分过程 · ${percent}%`;
}

function updateAssemblyUi(state: AssemblyState): void {
  const labels: Record<string, string> = {
    idle: explosion.getProgress() >= 0.995 ? "全部爆炸" : explosion.getProgress() <= 0.005 ? "完整状态" : "手动拆分",
    disassembling: `正在拆解 · ${state.stageLabel}`,
    assembling: `正在装配 · ${state.stageLabel}`,
    paused: `已暂停 · ${state.stageLabel}`,
  };
  assemblyState.textContent = labels[state.mode];
  const displayedStep =
    state.mode === "idle"
      ? explosion.getProgress() >= 0.995
        ? 8
        : explosion.getProgress() <= 0.005
          ? 0
          : state.stage + 1
      : state.stage + 1;
  assemblyStep.textContent = `STEP ${String(displayedStep).padStart(2, "0")} / 08`;
  pauseButton.textContent = state.mode === "paused" ? "▶" : "Ⅱ";
  pauseButton.classList.toggle("is-paused", state.mode === "paused");
  [...stageTrack.children].forEach((child, index) => {
    child.classList.toggle("active", index === state.stage && state.mode !== "idle");
  });
}

function showAll(): void {
  pavilion.components.forEach(({ object, data }) => {
    data.baseVisible = true;
    object.visible = true;
  });
  typeCheckboxes.forEach((checkbox) => {
    checkbox.checked = true;
  });
  updateCounts();
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
    driftFree ? `凉亭已复原；${pavilion.components.length} 个构件原始坐标校验通过` : "模型已复原，但发现构件坐标异常",
    driftFree ? "success" : "warning",
  );
}

slider.addEventListener("input", () => {
  assembly.stop();
  const progress = Number(slider.value) / 100;
  explosion.setProgress(progress);
  if (progress >= 0.52) setCameraPreset("exploded");
  if (progress <= 0.14) setCameraPreset("structure");
});

element<HTMLButtonElement>("complete-state").addEventListener("click", () => {
  assembly.stop();
  explosion.animateTo(0, 1.05);
  setCameraPreset("structure");
  showToast("正在恢复完整八角凉亭");
});

element<HTMLButtonElement>("full-explode").addEventListener("click", () => {
  assembly.stop();
  explosion.animateTo(1, 1.25);
  setCameraPreset("exploded");
  showToast(`正在展开 ${pavilion.components.length} 个构件的分层爆炸视图`);
});

element<HTMLButtonElement>("auto-disassemble").addEventListener("click", () => {
  assembly.startDisassembly();
  setCameraPreset("exploded");
  showToast("自动拆解已开始：从宝顶与屋面向台基推进");
});

element<HTMLButtonElement>("auto-assemble").addEventListener("click", () => {
  assembly.startAssembly();
  setCameraPreset("exploded");
  showToast("自动装配已开始：从台基与柱础向宝顶推进");
});

pauseButton.addEventListener("click", () => {
  const mode = assembly.togglePause();
  if (mode === "idle") showToast("当前没有正在运行的顺序动画", "warning");
});

element<HTMLButtonElement>("reset-model").addEventListener("click", resetModel);
element<HTMLButtonElement>("reset-camera").addEventListener("click", () => {
  setCameraPreset(explosion.getProgress() > 0.45 ? "exploded" : "structure", true);
  showToast("镜头正在返回轴测观察位");
});
element<HTMLButtonElement>("toggle-grid").addEventListener("click", () => {
  grid.visible = !grid.visible;
  showToast(grid.visible ? "分析网格已显示" : "分析网格已隐藏");
});
element<HTMLButtonElement>("show-all").addEventListener("click", () => {
  showAll();
  showToast("全部构件类别已恢复");
});
element<HTMLButtonElement>("isolate-layer").addEventListener("click", () => {
  if (!selectedData) return;
  pavilion.components.forEach(({ object, data }) => {
    object.visible = data.layer === selectedData!.layer;
    data.baseVisible = object.visible;
  });
  typeCheckboxes.forEach((checkbox, type) => {
    checkbox.checked = pavilion.components.some(
      ({ data, object }) => data.componentType === type && data.layer === selectedData!.layer && object.visible,
    );
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
supportCount.textContent = `${supportReport.valid} / ${supportReport.total}`;
supportNote.textContent =
  supportReport.invalidIds.length === 0 && bearingReport.invalidIds.length === 0
    ? `全部构件可回溯至地基；${bearingReport.valid}/${bearingReport.total} 根椽与檐檩接触`
    : `发现 ${supportReport.invalidIds.length} 个支撑异常、${bearingReport.invalidIds.length} 个接触异常`;

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
  showToast(`程序化生成完成：${pavilion.components.length} 个可操作构件`, "success");
}, 520);

window.addEventListener("error", (event) => {
  document.documentElement.dataset.runtimeError = event.message;
  showToast(`运行错误：${event.message}`, "warning");
});

interface PavilionTestApi {
  componentCount: number;
  getSupportReport(): PavilionSupportReport;
  getBearingReport(): PavilionBearingReport;
  setExplosion(value: number): void;
  getExplosion(): number;
  autoDisassemble(): void;
  autoAssemble(): void;
  getAssemblyMode(): string;
  verifyNoDrift(): boolean;
  resetModel(): void;
}

declare global {
  interface Window {
    __pavilionDemo: PavilionTestApi;
  }
}

window.__pavilionDemo = {
  componentCount: pavilion.components.length,
  getSupportReport: () => ({ ...supportReport, invalidIds: [...supportReport.invalidIds] }),
  getBearingReport: () => ({ ...bearingReport, invalidIds: [...bearingReport.invalidIds] }),
  setExplosion: (value) => {
    assembly.stop();
    explosion.setProgress(value);
  },
  getExplosion: () => explosion.getProgress(),
  autoDisassemble: () => assembly.startDisassembly(),
  autoAssemble: () => assembly.startAssembly(),
  getAssemblyMode: () => assembly.getMode(),
  verifyNoDrift: () => explosion.verifyNoDrift(),
  resetModel,
};

document.documentElement.dataset.modelComponentCount = String(pavilion.components.length);
document.documentElement.dataset.supportPathsValid = String(supportReport.invalidIds.length === 0);
document.documentElement.dataset.bearingContactsValid = String(bearingReport.invalidIds.length === 0);
document.documentElement.dataset.positionDriftFree = String(explosion.verifyNoDrift());
document.documentElement.dataset.runtimeReady = "true";
