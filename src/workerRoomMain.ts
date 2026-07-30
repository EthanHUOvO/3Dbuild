import "./workerRoom.css";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { AssemblyController, type AssemblyState } from "./animation/AssemblyController";
import { ExplosionController } from "./animation/ExplosionController";
import { SelectionManager } from "./interaction/SelectionManager";
import { ComponentType, type TempleComponentData } from "./temple/componentTypes";
import {
  WorkerRoomBuilder,
  WORKER_ROOM_ORDER,
  WORKER_ROOM_STAGES,
  WORKER_ROOM_TYPE_LABELS,
  type WorkerRoomComponentData,
  type WorkerRoomTask,
  type WorkerRoomZone,
} from "./worker-room/WorkerRoomBuilder";

const TYPE_ORDER = [
  ComponentType.FOUNDATION,
  ComponentType.FLOOR,
  ComponentType.WALL,
  ComponentType.ENCLOSURE,
  ComponentType.ROOF_PANEL,
  ComponentType.FIXTURE,
];

function element<T extends HTMLElement>(id: string): T {
  const target = document.getElementById(id);
  if (!target) throw new Error(`Required interface element #${id} is missing.`);
  return target as T;
}

const canvas = element<HTMLCanvasElement>("scene-canvas");
const viewport = element<HTMLElement>("viewport");
const slider = element<HTMLInputElement>("explosion-slider");
const stageTrack = element<HTMLElement>("stage-track");
const pauseButton = element<HTMLButtonElement>("pause-resume");
const toast = element<HTMLElement>("toast");

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07110f);
scene.fog = new THREE.FogExp2(0x07110f, 0.027);

const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 120);
const cameraPresets = {
  complete: {
    position: new THREE.Vector3(10.5, 8.2, 11.8),
    target: new THREE.Vector3(0, 1.25, 0),
  },
  exploded: {
    position: new THREE.Vector3(18, 14, 20),
    target: new THREE.Vector3(0, 3.1, 0),
  },
  interior: {
    position: new THREE.Vector3(8.2, 6.1, 3.8),
    target: new THREE.Vector3(0, 1.05, 0),
  },
} as const;
camera.position.copy(cameraPresets.complete.position);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.16;

const controls = new OrbitControls(camera, canvas);
controls.target.copy(cameraPresets.complete.target);
controls.enableDamping = true;
controls.dampingFactor = 0.065;
controls.minDistance = 5;
controls.maxDistance = 60;
controls.maxPolarAngle = Math.PI * 0.49;
controls.screenSpacePanning = false;

scene.add(new THREE.HemisphereLight(0xc8e1dc, 0x17211e, 2.2));
scene.add(new THREE.AmbientLight(0x9ebbb5, 0.42));

const keyLight = new THREE.DirectionalLight(0xfff1d5, 5.4);
keyLight.position.set(11, 17, 13);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.left = -20;
keyLight.shadow.camera.right = 20;
keyLight.shadow.camera.top = 20;
keyLight.shadow.camera.bottom = -15;
keyLight.shadow.bias = -0.00025;
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0x66cfc2, 1.8);
fillLight.position.set(-12, 8, -10);
scene.add(fillLight);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(36, 30),
  new THREE.MeshStandardMaterial({ color: 0x121d1a, roughness: 0.97 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.02;
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(28, 28, 0x3f746b, 0x203d37);
grid.position.y = 0.005;
const gridMaterial = grid.material as THREE.Material;
gridMaterial.transparent = true;
gridMaterial.opacity = 0.24;
scene.add(grid);

const room = new WorkerRoomBuilder().build();
scene.add(room.root);
const supportReport = WorkerRoomBuilder.validateSupportPaths(room);
const taskPlan = WorkerRoomBuilder.getTaskPlan(room);

const explosion = new ExplosionController(room.components);
const assembly = new AssemblyController(room.components, explosion, WORKER_ROOM_ORDER, WORKER_ROOM_STAGES);
const selection = new SelectionManager(canvas, camera, [room.root], room.components);

const typeVisibility = new Map<ComponentType, boolean>(TYPE_ORDER.map((type) => [type, true]));
const zoneVisibility = new Map<WorkerRoomZone, boolean>([
  ["SHELL", true],
  ["LIVING", true],
]);
const typeCheckboxes = new Map<ComponentType, HTMLInputElement>();

let selectedData: WorkerRoomComponentData | null = null;
let toastTimer = 0;
let currentCameraPreset: keyof typeof cameraPresets = "complete";
let currentAssemblyState: AssemblyState = {
  mode: "idle",
  stage: WORKER_ROOM_STAGES.length - 1,
  stageLabel: "基础底座",
  overall: 0,
};
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

function createFilters(): void {
  const host = element<HTMLElement>("type-filters");
  TYPE_ORDER.forEach((type) => {
    const count = room.components.filter(({ data }) => data.componentType === type).length;
    if (count === 0) return;
    const labelData = WORKER_ROOM_TYPE_LABELS[type];
    if (!labelData) return;
    const label = document.createElement("label");
    label.className = "filter-row";
    label.style.setProperty("--filter-color", labelData.color);
    label.innerHTML = `
      <input type="checkbox" checked aria-label="显示或隐藏${labelData.zh}" />
      <span class="filter-toggle"><i></i></span>
      <i class="filter-color"></i>
      <span class="filter-name"><strong>${labelData.zh}</strong><span>${labelData.en.toUpperCase()}</span></span>
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
  WORKER_ROOM_STAGES.forEach((label, index) => {
    const item = document.createElement("span");
    item.textContent = `${index + 1} ${label}`;
    item.title = label;
    stageTrack.append(item);
  });
}

function createTaskList(): void {
  const host = element<HTMLElement>("task-list");
  host.innerHTML = "";
  taskPlan.forEach((task) => {
    const row = document.createElement("article");
    row.className = "task-row";
    row.dataset.stage = String(task.stageIndex);
    row.innerHTML = `
      <div class="task-code">${task.code}</div>
      <div class="task-copy">
        <strong>${task.name}</strong>
        <span>${task.resource} · ${task.duration}</span>
      </div>
      <em>${task.componentIds.length} 件</em>
    `;
    row.addEventListener("click", () => {
      const firstId = task.componentIds[0];
      if (firstId) selection.selectById(firstId);
    });
    host.append(row);
  });
}

function applyVisibility(): void {
  room.components.forEach(({ object, data }) => {
    const workerData = data as WorkerRoomComponentData;
    const visible =
      (typeVisibility.get(data.componentType) ?? true) && (zoneVisibility.get(workerData.zone) ?? true);
    data.baseVisible = visible;
    object.visible = visible;
  });
  updateCounts();
}

function updateCounts(): void {
  const visible = room.components.filter(({ object }) => object.visible).length;
  element<HTMLElement>("visible-count").textContent = String(visible);
  element<HTMLElement>("total-count").textContent = String(room.components.length);
  element<HTMLElement>("tab-count").textContent = String(room.components.length);
}

function reachesFoundation(componentId: string, visiting = new Set<string>()): boolean {
  if (componentId === "WR-FND-01") return true;
  if (visiting.has(componentId)) return false;
  const component = room.componentMap.get(componentId);
  if (!component) return false;
  const next = new Set(visiting).add(componentId);
  return component.data.supportedBy.some((supportId) => reachesFoundation(supportId, next));
}

function resolveNames(ids: string[]): string {
  if (ids.length === 0) return "GROUND / 地面";
  return ids
    .slice(0, 5)
    .map((id) => {
      const data = room.componentMap.get(id)?.data;
      return data ? `${data.componentNameZh} (${id})` : id;
    })
    .join(" · ");
}

function updateSelection(data: TempleComponentData | null): void {
  selectedData = data as WorkerRoomComponentData | null;
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
  element<HTMLElement>("component-name").textContent = `${selectedData.componentNameZh} · ${selectedData.componentNameEn}`;
  element<HTMLElement>("component-status").textContent = selectedData.status;
  element<HTMLElement>("component-id").textContent = selectedData.componentId;
  element<HTMLElement>("component-zone").textContent = selectedData.zone === "SHELL" ? "建筑外壳 / SHELL" : "居住设施 / LIVING";
  element<HTMLElement>("component-system").textContent = selectedData.system;
  element<HTMLElement>("component-material").textContent = selectedData.materialName;
  element<HTMLElement>("component-dimensions").textContent = selectedData.dimensions;
  element<HTMLElement>("component-task").textContent = selectedData.taskCode;
  element<HTMLElement>("component-layer").textContent = `L${String(selectedData.layer).padStart(2, "0")} · STEP ${String(selectedData.assemblyStep).padStart(2, "0")}`;
  element<HTMLElement>("component-position").textContent = `${selectedData.originalPosition.x.toFixed(2)}, ${selectedData.originalPosition.y.toFixed(2)}, ${selectedData.originalPosition.z.toFixed(2)}`;
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
  toast.className = `worker-toast visible ${variant}`;
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 2600);
}

function setCameraPreset(preset: keyof typeof cameraPresets, force = false): void {
  if (!force && currentCameraPreset === preset) return;
  currentCameraPreset = preset;
  const targetPreset = cameraPresets[preset];
  cameraTween = {
    elapsed: 0,
    duration: 0.9,
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
  element<HTMLElement>("view-label").textContent =
    percent === 0 ? "完整样板间 · AXONOMETRIC" : percent === 100 ? "构件爆炸 · EXPLODED" : `拆分过程 · ${percent}%`;

  if (assembly.getMode() === "idle") {
    element<HTMLElement>("assembly-state").textContent = percent === 0 ? "完整状态" : percent === 100 ? "全部爆炸" : "手动拆分";
    element<HTMLElement>("assembly-step").textContent = `STEP ${percent === 0 ? "00" : percent === 100 ? "06" : "--"} / 06`;
  }
  updateTaskBoard();
}

function updateAssemblyUi(state: AssemblyState): void {
  currentAssemblyState = state;
  const labels: Record<string, string> = {
    idle: explosion.getProgress() >= 0.995 ? "全部爆炸" : explosion.getProgress() <= 0.005 ? "完整状态" : "手动拆分",
    disassembling: `正在拆解 · ${state.stageLabel}`,
    assembling: `正在装配 · ${state.stageLabel}`,
    paused: `已暂停 · ${state.stageLabel}`,
  };
  element<HTMLElement>("assembly-state").textContent = labels[state.mode];
  const displayedStep = state.mode === "idle" ? (explosion.getProgress() >= 0.995 ? 6 : explosion.getProgress() <= 0.005 ? 0 : state.stage + 1) : state.stage + 1;
  element<HTMLElement>("assembly-step").textContent = `STEP ${String(displayedStep).padStart(2, "0")} / 06`;
  pauseButton.textContent = state.mode === "paused" ? "▶" : "Ⅱ";
  pauseButton.classList.toggle("is-paused", state.mode === "paused");
  [...stageTrack.children].forEach((child, index) => child.classList.toggle("active", index === state.stage && state.mode !== "idle"));
  updateTaskBoard();
}

function taskStatus(task: WorkerRoomTask): "done" | "active" | "waiting" {
  const progress = explosion.getProgress();
  const mode = currentAssemblyState.mode;
  if (mode === "assembling" || (mode === "paused" && progress > 0.5)) {
    if (task.stageIndex > currentAssemblyState.stage) return "done";
    if (task.stageIndex === currentAssemblyState.stage) return "active";
    return "waiting";
  }
  if (mode === "disassembling" || (mode === "paused" && progress <= 0.5)) {
    if (task.stageIndex < currentAssemblyState.stage) return "done";
    if (task.stageIndex === currentAssemblyState.stage) return "active";
    return "waiting";
  }
  if (progress <= 0.005) return "done";
  if (progress >= 0.995) return "waiting";
  return task.stageIndex === currentAssemblyState.stage ? "active" : "waiting";
}

function updateTaskBoard(): void {
  const rows = [...document.querySelectorAll<HTMLElement>(".task-row")];
  let done = 0;
  rows.forEach((row, index) => {
    const status = taskStatus(taskPlan[index]);
    row.dataset.status = status;
    row.classList.toggle("active", status === "active");
    row.classList.toggle("done", status === "done");
    const statusLabel = status === "done" ? "完成" : status === "active" ? "执行中" : "待执行";
    row.setAttribute("aria-label", `${taskPlan[index].name}：${statusLabel}`);
    if (status === "done") done += 1;
  });
  element<HTMLElement>("task-summary").textContent = `${done} / ${taskPlan.length} COMPLETED`;
}

function showAll(): void {
  typeVisibility.forEach((_, type) => typeVisibility.set(type, true));
  zoneVisibility.forEach((_, zone) => zoneVisibility.set(zone, true));
  typeCheckboxes.forEach((checkbox) => (checkbox.checked = true));
  document.querySelectorAll<HTMLInputElement>("[data-zone]").forEach((checkbox) => (checkbox.checked = true));
  applyVisibility();
}

function resetModel(): void {
  assembly.stop();
  selection.clear();
  showAll();
  explosion.setProgress(0);
  const driftFree = explosion.verifyNoDrift();
  setCameraPreset("complete", true);
  showToast(
    driftFree ? `样板间已复原；${room.components.length} 个构件坐标校验通过` : "模型已复原，但发现坐标异常",
    driftFree ? "success" : "warning",
  );
}

slider.addEventListener("input", () => {
  assembly.stop();
  const progress = Number(slider.value) / 100;
  explosion.setProgress(progress);
  if (progress >= 0.45) setCameraPreset("exploded");
  if (progress <= 0.12) setCameraPreset("complete");
});

element<HTMLButtonElement>("complete-state").addEventListener("click", () => {
  assembly.stop();
  explosion.animateTo(0, 1.0);
  setCameraPreset("complete");
  showToast("正在恢复完整样板间");
});

element<HTMLButtonElement>("full-explode").addEventListener("click", () => {
  assembly.stop();
  explosion.animateTo(1, 1.25);
  setCameraPreset("exploded");
  showToast(`正在展开 ${room.components.length} 个基本构件`);
});

element<HTMLButtonElement>("auto-disassemble").addEventListener("click", () => {
  assembly.startDisassembly();
  setCameraPreset("exploded");
  showToast("自动拆解：生活设施 → 门窗 → 屋顶 → 墙体 → 地板 → 基础");
});

element<HTMLButtonElement>("auto-assemble").addEventListener("click", () => {
  assembly.startAssembly();
  setCameraPreset("exploded");
  showToast("自动装配：基础 → 地板 → 墙体 → 屋顶 → 门窗 → 生活设施");
});

pauseButton.addEventListener("click", () => {
  const mode = assembly.togglePause();
  if (mode === "idle") showToast("当前没有正在运行的顺序动画", "warning");
});

document.querySelectorAll<HTMLInputElement>("[data-zone]").forEach((checkbox) => {
  checkbox.addEventListener("change", () => {
    zoneVisibility.set(checkbox.dataset.zone as WorkerRoomZone, checkbox.checked);
    applyVisibility();
  });
});

element<HTMLButtonElement>("show-all").addEventListener("click", () => {
  showAll();
  showToast("全部构件已显示");
});

element<HTMLButtonElement>("reset-model").addEventListener("click", resetModel);
element<HTMLButtonElement>("reset-camera").addEventListener("click", () => {
  setCameraPreset(explosion.getProgress() > 0.42 ? "exploded" : "complete", true);
  showToast("镜头正在返回观察位");
});
element<HTMLButtonElement>("interior-view").addEventListener("click", () => {
  setCameraPreset("interior", true);
  showToast("已切换到室内观察位");
});
element<HTMLButtonElement>("toggle-grid").addEventListener("click", () => {
  grid.visible = !grid.visible;
  showToast(grid.visible ? "分析网格已显示" : "分析网格已隐藏");
});

element<HTMLButtonElement>("isolate-layer").addEventListener("click", () => {
  if (!selectedData) return;
  room.components.forEach(({ object, data }) => {
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
createTaskList();
updateCounts();
updateTaskBoard();

element<HTMLElement>("support-count").textContent = `${supportReport.valid} / ${supportReport.total}`;
element<HTMLElement>("support-note").textContent = supportReport.invalidIds.length === 0 ? "全部构件均可回溯至整体基础" : `异常：${supportReport.invalidIds.join(", ")}`;

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
  element<HTMLElement>("loading").classList.add("hidden");
  showToast(`简易工人样板间已生成：${room.components.length} 个构件`, "success");
}, 380);
