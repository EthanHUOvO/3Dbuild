import "./styles.css";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TempleBuilder } from "./temple/TempleBuilder";
import {
  ComponentStatus,
  ComponentType,
  type QueryStatus,
} from "./temple/componentTypes";
import { ExplosionController } from "./animation/ExplosionController";
import { AssemblyController } from "./animation/AssemblyController";
import { SelectionManager } from "./interaction/SelectionManager";
import { RepairScenarioManager, type ScenarioId } from "./repair/RepairScenarioManager";
import { UIController } from "./ui/UIController";

const canvas = document.getElementById("scene-canvas") as HTMLCanvasElement;
const viewport = document.getElementById("viewport") as HTMLElement;
if (!canvas || !viewport) throw new Error("3D viewport is unavailable.");

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x071110);
scene.fog = new THREE.FogExp2(0x071110, 0.019);

const camera = new THREE.PerspectiveCamera(37, 1, 0.1, 120);
const defaultCameraPosition = new THREE.Vector3(25, 18, 27);
const defaultTarget = new THREE.Vector3(0, 5.7, 0);
const explodedCameraPosition = new THREE.Vector3(41, 32, 46);
const explodedTarget = new THREE.Vector3(0, 10.8, 0);
camera.position.copy(defaultCameraPosition);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const controls = new OrbitControls(camera, canvas);
controls.target.copy(defaultTarget);
controls.enableDamping = true;
controls.dampingFactor = 0.065;
controls.minDistance = 12;
controls.maxDistance = 70;
controls.maxPolarAngle = Math.PI * 0.49;
controls.screenSpacePanning = false;

const ambient = new THREE.HemisphereLight(0x9fc9c4, 0x18201b, 1.45);
scene.add(ambient);

const keyLight = new THREE.DirectionalLight(0xffe8c2, 4.1);
keyLight.position.set(18, 28, 16);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.left = -30;
keyLight.shadow.camera.right = 30;
keyLight.shadow.camera.top = 26;
keyLight.shadow.camera.bottom = -20;
keyLight.shadow.bias = -0.00025;
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0x57a9a4, 1.55);
fillLight.position.set(-22, 12, -14);
scene.add(fillLight);

const rimLight = new THREE.PointLight(0xd0a657, 22, 42, 2);
rimLight.position.set(-12, 14, 14);
scene.add(rimLight);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(42, 80),
  new THREE.MeshStandardMaterial({ color: 0x101b19, roughness: 0.94, metalness: 0.03 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.28;
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(60, 30, 0x315a55, 0x1b3430);
grid.position.y = -0.25;
const gridMaterial = grid.material as THREE.Material;
gridMaterial.transparent = true;
gridMaterial.opacity = 0.28;
scene.add(grid);

const halo = new THREE.Mesh(
  new THREE.RingGeometry(18, 31, 72),
  new THREE.MeshBasicMaterial({
    color: 0x17322e,
    transparent: true,
    opacity: 0.18,
    side: THREE.DoubleSide,
    depthWrite: false,
  }),
);
halo.rotation.x = -Math.PI / 2;
halo.position.y = -0.2;
scene.add(halo);

const temple = new TempleBuilder().build();
scene.add(temple.root);

const explosion = new ExplosionController(temple.components);
const assembly = new AssemblyController(temple.components, explosion);
const repair = new RepairScenarioManager(temple);
const selection = new SelectionManager(canvas, camera, [temple.root], temple.components);

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
let cameraPreset: "structure" | "exploded" = "structure";
let currentMode: "structure" | "repair" = "structure";

const ui = new UIController(temple.components, {
  onExplosionChange: (value) => {
    assembly.stop();
    explosion.setProgress(value);
    if (value >= 0.55 && cameraPreset !== "exploded") setCameraPreset("exploded");
    if (value <= 0.15 && cameraPreset !== "structure") setCameraPreset("structure");
  },
  onCompleteState: () => {
    assembly.stop();
    explosion.animateTo(0, 1.15);
    setCameraPreset("structure");
    ui.showToast("正在恢复全部构件至原始坐标");
  },
  onFullExplode: () => {
    assembly.stop();
    explosion.animateTo(1, 1.35);
    setCameraPreset("exploded");
    ui.showToast("正在生成分层爆炸视图");
  },
  onAutoDisassemble: () => {
    ensureStructureMode();
    assembly.startDisassembly();
    setCameraPreset("exploded");
    ui.showToast("自动拆解已开始：从屋脊与屋面向台基推进");
  },
  onAutoAssemble: () => {
    ensureStructureMode();
    assembly.startAssembly();
    setCameraPreset("exploded");
    ui.showToast("自动装配已开始：从台基与柱础向屋脊推进");
  },
  onPauseResume: () => {
    const mode = assembly.togglePause();
    if (mode === "idle") ui.showToast("当前没有正在运行的顺序动画", "warning");
  },
  onResetCamera: resetCamera,
  onResetModel: resetModel,
  onToggleGrid: () => {
    grid.visible = !grid.visible;
    ui.showToast(grid.visible ? "分析网格已显示" : "分析网格已隐藏");
  },
  onTypeVisibility: (type, visible) => {
    temple.components.forEach(({ object, data }) => {
      if (data.componentType !== type) return;
      data.baseVisible = visible;
      object.visible = visible && data.status !== ComponentStatus.MISSING;
    });
    ui.updateCounts();
  },
  onShowAll: () => {
    temple.components.forEach(({ object, data }) => {
      data.baseVisible = true;
      object.visible = data.status !== ComponentStatus.MISSING;
    });
    ui.updateCounts();
    ui.showToast("全部构件图层已恢复");
  },
  onIsolateLayer: (layer) => {
    temple.components.forEach(({ object, data }) => {
      data.baseVisible = data.layer === layer;
      object.visible = data.baseVisible && data.status !== ComponentStatus.MISSING;
    });
    ui.updateCounts();
    ui.showToast(`已隔离显示装配层 L${String(layer).padStart(2, "0")}`);
  },
  onModeChange: (mode) => {
    currentMode = mode;
    assembly.stop();
    explosion.animateTo(0, 0.75);
    if (mode === "repair") activateScenario("dougong");
    else {
      repair.resetAll();
      selection.clear();
      ui.showToast("已返回结构拆解与装配模式");
    }
  },
  onScenarioChange: activateScenario,
  onApplyRepair: () => {
    if (repair.applyRepair()) ui.showToast("候选构件正在沿语义定位路径回装", "info");
  },
  onResetScenario: () => {
    const state = repair.resetCurrent();
    if (state?.target) selection.selectById(state.target.data.componentId);
    ui.showToast("缺陷案例已重置，可再次执行修复");
  },
});

selection.setSelectionCallback((data) => ui.updateSelection(data));
explosion.setProgressCallback((progress) => ui.setExplosionProgress(progress));
assembly.setStateCallback((state) => ui.updateAssembly(state));
repair.setStateCallback((state) => {
  ui.updateRepair(state);
  ui.updateCounts();
  if (state.queryStatus === "REPAIRED") {
    ui.showToast("修复完成：结构支撑路径已恢复", "success");
  }
});

function activateScenario(id: ScenarioId): void {
  currentMode = "repair";
  ui.setMode("repair");
  ui.setScenario(id);
  assembly.stop();
  explosion.setProgress(0);
  temple.components.forEach(({ object, data }) => {
    data.baseVisible = true;
    object.visible = true;
  });
  ui.syncAllTypeVisibility(true);
  const state = repair.activate(id);
  if (state.target) selection.selectById(state.target.data.componentId);
  ui.updateRepair(state);
  ui.updateCounts();
  ui.showToast(id === "dougong" ? "已加载案例 A：缺失斗拱" : "已加载案例 B：缺失横梁", "warning");
}

function ensureStructureMode(): void {
  if (currentMode === "repair") {
    currentMode = "structure";
    repair.resetAll();
    selection.clear();
    ui.setMode("structure");
  }
}

function resetCamera(): void {
  setCameraPreset(explosion.getProgress() > 0.45 ? "exploded" : "structure", true);
}

function setCameraPreset(preset: "structure" | "exploded", force = false): void {
  if (!force && cameraPreset === preset) return;
  cameraPreset = preset;
  cameraTween = {
    elapsed: 0,
    duration: 1.05,
    fromPosition: camera.position.clone(),
    fromTarget: controls.target.clone(),
    toPosition: (preset === "exploded" ? explodedCameraPosition : defaultCameraPosition).clone(),
    toTarget: (preset === "exploded" ? explodedTarget : defaultTarget).clone(),
  };
  ui.showToast("镜头正在返回轴测观察位");
}

function resetModel(): void {
  currentMode = "structure";
  assembly.stop();
  repair.resetAll();
  selection.clear();
  explosion.setProgress(0);
  temple.components.forEach(({ object, data }) => {
    data.baseVisible = true;
    object.visible = true;
  });
  ui.syncAllTypeVisibility(true);
  ui.setMode("structure");
  const driftFree = explosion.verifyNoDrift();
  document.documentElement.dataset.positionDriftFree = String(driftFree);
  resetCamera();
  ui.showToast(
    driftFree ? "模型、筛选与语义状态已重置；原始坐标校验通过" : "模型已重置，但坐标校验发现异常",
    driftFree ? "success" : "warning",
  );
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
  repair.update(delta);
  updateCameraTween(delta);
  controls.update();
  renderer.render(scene, camera);
}
render();

window.addEventListener("error", (event) => {
  ui.showToast(`运行错误：${event.message}`, "warning");
});

window.setTimeout(() => {
  ui.setLoading(false);
  ui.showToast(`程序化生成完成：${temple.components.length} 个可操作构件`, "success");
}, 620);

interface HeritageTestApi {
  componentCount: number;
  setExplosion(value: number): void;
  getExplosion(): number;
  autoDisassemble(): void;
  autoAssemble(): void;
  getAssemblyMode(): string;
  activateRepair(id: ScenarioId): void;
  applyRepair(): void;
  resetRepair(): void;
  getQueryStatus(): QueryStatus;
  verifyNoDrift(): boolean;
  resetModel(): void;
}

declare global {
  interface Window {
    __heritageDemo: HeritageTestApi;
  }
}

window.__heritageDemo = {
  componentCount: temple.components.length,
  setExplosion: (value) => {
    assembly.stop();
    explosion.setProgress(value);
  },
  getExplosion: () => explosion.getProgress(),
  autoDisassemble: () => {
    ensureStructureMode();
    assembly.startDisassembly();
  },
  autoAssemble: () => {
    ensureStructureMode();
    assembly.startAssembly();
  },
  getAssemblyMode: () => assembly.getMode(),
  activateRepair: (id) => activateScenario(id),
  applyRepair: () => {
    repair.applyRepair();
  },
  resetRepair: () => {
    repair.resetCurrent();
  },
  getQueryStatus: () => repair.getState().queryStatus,
  verifyNoDrift: () => explosion.verifyNoDrift(),
  resetModel,
};

document.documentElement.dataset.modelComponentCount = String(temple.components.length);
document.documentElement.dataset.positionDriftFree = String(explosion.verifyNoDrift());
