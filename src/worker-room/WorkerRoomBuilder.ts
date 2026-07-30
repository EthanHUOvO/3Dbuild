import * as THREE from "three";
import {
  ComponentStatus,
  ComponentType,
  type TempleComponent,
  type TempleComponentData,
  type TempleModel,
} from "../temple/componentTypes";

export type WorkerRoomZone = "SHELL" | "LIVING";
export type WorkerRoomSystem = "STRUCTURE" | "ENCLOSURE" | "FURNITURE" | "ELECTRICAL";

export interface WorkerRoomComponentData extends TempleComponentData {
  zone: WorkerRoomZone;
  system: WorkerRoomSystem;
  materialName: string;
  dimensions: string;
  taskCode: string;
}

interface ComponentSpec {
  id: string;
  nameZh: string;
  nameEn: string;
  type: ComponentType;
  zone: WorkerRoomZone;
  system: WorkerRoomSystem;
  layer: number;
  step: number;
  materialName: string;
  dimensions: string;
  taskCode: string;
  parentIds?: string[];
  connectedTo?: string[];
  supportedBy?: string[];
}

export interface WorkerRoomSupportReport {
  valid: number;
  total: number;
  invalidIds: string[];
}

export interface WorkerRoomTask {
  code: string;
  name: string;
  stageIndex: number;
  componentIds: string[];
  resource: string;
  duration: string;
}

const ROOT_ID = "WR-FND-01";
const FLOOR_ID = "WR-FLR-01";

const WIDTH = 6;
const DEPTH = 3.6;
const WALL_HEIGHT = 2.5;
const WALL_THICKNESS = 0.16;
const FLOOR_TOP = 0.39;

export const WORKER_ROOM_ORDER: ComponentType[][] = [
  [ComponentType.FIXTURE],
  [ComponentType.ENCLOSURE],
  [ComponentType.ROOF_PANEL],
  [ComponentType.WALL],
  [ComponentType.FLOOR],
  [ComponentType.FOUNDATION],
];

export const WORKER_ROOM_STAGES = [
  "生活设施",
  "门窗围护",
  "屋顶模块",
  "墙体模块",
  "地板模块",
  "基础底座",
];

export const WORKER_ROOM_TYPE_LABELS: Partial<
  Record<ComponentType, { zh: string; en: string; color: string }>
> = {
  [ComponentType.FOUNDATION]: { zh: "基础底座", en: "Foundation", color: "#9aa9a6" },
  [ComponentType.FLOOR]: { zh: "地板模块", en: "Floor", color: "#c1b9a8" },
  [ComponentType.WALL]: { zh: "墙体模块", en: "Wall", color: "#d8d8d1" },
  [ComponentType.ENCLOSURE]: { zh: "门窗围护", en: "Door / Window", color: "#77a9a5" },
  [ComponentType.ROOF_PANEL]: { zh: "屋顶模块", en: "Roof", color: "#536f72" },
  [ComponentType.FIXTURE]: { zh: "生活设施", en: "Living fixture", color: "#b8875d" },
};

export class WorkerRoomBuilder {
  private readonly root = new THREE.Group();
  private readonly components: TempleComponent[] = [];
  private readonly componentMap = new Map<string, TempleComponent>();

  private readonly materials = {
    concrete: new THREE.MeshStandardMaterial({ color: 0x8e9998, roughness: 0.9 }),
    floor: new THREE.MeshStandardMaterial({ color: 0xb99e79, roughness: 0.78 }),
    wall: new THREE.MeshStandardMaterial({ color: 0xd8d8d1, roughness: 0.86 }),
    wallEdge: new THREE.MeshStandardMaterial({ color: 0xaeb8b6, roughness: 0.8 }),
    roof: new THREE.MeshStandardMaterial({ color: 0x48666a, roughness: 0.72, metalness: 0.08 }),
    timber: new THREE.MeshStandardMaterial({ color: 0x9d6f48, roughness: 0.72 }),
    mattress: new THREE.MeshStandardMaterial({ color: 0xd9ded7, roughness: 0.92 }),
    textile: new THREE.MeshStandardMaterial({ color: 0x6f8780, roughness: 0.96 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x697472, roughness: 0.38, metalness: 0.65 }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0x9fd5d0,
      transparent: true,
      opacity: 0.3,
      roughness: 0.12,
      metalness: 0,
      transmission: 0.45,
      depthWrite: false,
    }),
    light: new THREE.MeshStandardMaterial({
      color: 0xffe6a8,
      emissive: 0xffc65c,
      emissiveIntensity: 1.1,
      roughness: 0.32,
    }),
  };

  build(): TempleModel {
    this.root.name = "Simple Worker Housing Sample Room";

    this.buildFoundationAndFloor();
    const walls = this.buildWalls();
    const enclosures = this.buildDoorAndWindows(walls);
    const roofs = this.buildRoof(walls);
    this.buildLivingFixtures(roofs);
    this.finalizeConnections();

    this.root.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    return {
      root: this.root,
      components: this.components,
      componentMap: this.componentMap,
      scenarioAnchors: {
        missingDougongId: enclosures.door,
        dougongAffectedRoofId: roofs.left,
        missingBeamId: walls.front,
        beamAffectedRoofId: roofs.right,
      },
    };
  }

  static validateSupportPaths(model: TempleModel): WorkerRoomSupportReport {
    const memo = new Map<string, boolean>();
    const reachesFoundation = (id: string, visiting: Set<string>): boolean => {
      if (id === ROOT_ID) return true;
      if (memo.has(id)) return memo.get(id)!;
      if (visiting.has(id)) return false;
      const component = model.componentMap.get(id);
      if (!component || component.data.supportedBy.length === 0) return false;
      const next = new Set(visiting).add(id);
      const result = component.data.supportedBy.some((supportId) => reachesFoundation(supportId, next));
      memo.set(id, result);
      return result;
    };

    const invalidIds = model.components
      .filter(({ data }) => !reachesFoundation(data.componentId, new Set()))
      .map(({ data }) => data.componentId);

    return {
      valid: model.components.length - invalidIds.length,
      total: model.components.length,
      invalidIds,
    };
  }

  static getTaskPlan(model: TempleModel): WorkerRoomTask[] {
    const ids = (type: ComponentType) =>
      model.components.filter(({ data }) => data.componentType === type).map(({ data }) => data.componentId);

    return [
      {
        code: "T01",
        name: "基础定位与底座就位",
        stageIndex: 5,
        componentIds: ids(ComponentType.FOUNDATION),
        resource: "测量 + 吊装",
        duration: "0.5 天",
      },
      {
        code: "T02",
        name: "地板模块安装",
        stageIndex: 4,
        componentIds: ids(ComponentType.FLOOR),
        resource: "2 人 + 吊装",
        duration: "0.5 天",
      },
      {
        code: "T03",
        name: "四周墙体安装",
        stageIndex: 3,
        componentIds: ids(ComponentType.WALL),
        resource: "3 人 + 机械臂",
        duration: "1.0 天",
      },
      {
        code: "T04",
        name: "屋顶模块封装",
        stageIndex: 2,
        componentIds: ids(ComponentType.ROOF_PANEL),
        resource: "吊装设备",
        duration: "0.5 天",
      },
      {
        code: "T05",
        name: "门窗围护安装",
        stageIndex: 1,
        componentIds: ids(ComponentType.ENCLOSURE),
        resource: "2 人",
        duration: "0.5 天",
      },
      {
        code: "T06",
        name: "床铺与生活设施布置",
        stageIndex: 0,
        componentIds: ids(ComponentType.FIXTURE),
        resource: "2 人",
        duration: "0.5 天",
      },
    ];
  }

  private addComponent(object: THREE.Object3D, spec: ComponentSpec): string {
    const originalPosition = object.position.clone();
    const explodedPosition = originalPosition.clone().add(this.explosionOffset(spec, originalPosition));
    const data: WorkerRoomComponentData = {
      componentId: spec.id,
      componentNameZh: spec.nameZh,
      componentNameEn: spec.nameEn,
      componentType: spec.type,
      layer: spec.layer,
      assemblyStep: spec.step,
      originalPosition,
      explodedPosition,
      parentIds: spec.parentIds ?? [],
      connectedTo: spec.connectedTo ?? [],
      supportedBy: spec.supportedBy ?? [],
      status: ComponentStatus.ACTIVE,
      baseVisible: true,
      zone: spec.zone,
      system: spec.system,
      materialName: spec.materialName,
      dimensions: spec.dimensions,
      taskCode: spec.taskCode,
    };

    object.userData.componentData = data;
    object.name = `${spec.id} · ${spec.nameZh}`;
    this.root.add(object);

    const component: TempleComponent = { object, data };
    this.components.push(component);
    this.componentMap.set(spec.id, component);
    return spec.id;
  }

  private explosionOffset(spec: ComponentSpec, position: THREE.Vector3): THREE.Vector3 {
    switch (spec.type) {
      case ComponentType.FOUNDATION:
        return new THREE.Vector3(0, -2.2, 0);
      case ComponentType.FLOOR:
        return new THREE.Vector3(0, -1.1, 0);
      case ComponentType.WALL: {
        if (spec.id.includes("LEFT")) return new THREE.Vector3(-5.1, 1.1, 0);
        if (spec.id.includes("RIGHT")) return new THREE.Vector3(5.1, 1.1, 0);
        if (spec.id.includes("BACK")) return new THREE.Vector3(0, 1.5, -4.4);
        return new THREE.Vector3(0, 1.5, 4.4);
      }
      case ComponentType.ENCLOSURE: {
        const xDirection = position.x < -0.5 ? -1 : position.x > 0.5 ? 1 : 0;
        const zDirection = position.z < -0.5 ? -1 : position.z > 0.5 ? 1 : 0;
        return new THREE.Vector3(xDirection * 7.2, 2.3, zDirection * 6.2);
      }
      case ComponentType.ROOF_PANEL:
        return new THREE.Vector3(spec.id.endsWith("L") ? -3.5 : 3.5, 6.8, 0);
      case ComponentType.FIXTURE: {
        const side = position.x <= 0 ? -1 : 1;
        return new THREE.Vector3(side * 4.4, 3.1 + Math.abs(position.z) * 0.35, position.z * 1.6);
      }
      default:
        return new THREE.Vector3(0, 3, 0);
    }
  }

  private buildFoundationAndFloor(): void {
    this.addComponent(this.box(6.4, 0.25, 4, 0, 0.125, 0, this.materials.concrete), {
      id: ROOT_ID,
      nameZh: "整体基础底座",
      nameEn: "Foundation base",
      type: ComponentType.FOUNDATION,
      zone: "SHELL",
      system: "STRUCTURE",
      layer: 0,
      step: 1,
      materialName: "预制混凝土",
      dimensions: "6400 × 4000 × 250 mm",
      taskCode: "T01",
    });

    this.addComponent(this.box(WIDTH, 0.14, DEPTH, 0, 0.32, 0, this.materials.floor), {
      id: FLOOR_ID,
      nameZh: "整体地板模块",
      nameEn: "Floor cassette",
      type: ComponentType.FLOOR,
      zone: "SHELL",
      system: "STRUCTURE",
      layer: 1,
      step: 2,
      materialName: "轻钢龙骨复合地板",
      dimensions: "6000 × 3600 × 140 mm",
      taskCode: "T02",
      supportedBy: [ROOT_ID],
      connectedTo: [ROOT_ID],
    });
  }

  private buildWalls(): { left: string; right: string; back: string; front: string } {
    const wallY = FLOOR_TOP + WALL_HEIGHT / 2;
    const left = this.addComponent(
      this.box(WALL_THICKNESS, WALL_HEIGHT, DEPTH, -WIDTH / 2 + WALL_THICKNESS / 2, wallY, 0, this.materials.wall),
      {
        id: "WR-WALL-LEFT",
        nameZh: "左侧墙体模块",
        nameEn: "Left wall module",
        type: ComponentType.WALL,
        zone: "SHELL",
        system: "STRUCTURE",
        layer: 2,
        step: 3,
        materialName: "保温夹芯墙板",
        dimensions: "3600 × 2500 × 160 mm",
        taskCode: "T03",
        supportedBy: [FLOOR_ID],
      },
    );

    const rightGroup = this.buildSideWallWithWindow(1.0);
    const right = this.addComponent(rightGroup, {
      id: "WR-WALL-RIGHT",
      nameZh: "右侧墙体模块",
      nameEn: "Right wall module",
      type: ComponentType.WALL,
      zone: "SHELL",
      system: "STRUCTURE",
      layer: 2,
      step: 3,
      materialName: "保温夹芯墙板",
      dimensions: "3600 × 2500 × 160 mm（含窗洞）",
      taskCode: "T03",
      supportedBy: [FLOOR_ID],
    });

    const backGroup = this.buildBackWallWithWindow(1.25);
    const back = this.addComponent(backGroup, {
      id: "WR-WALL-BACK",
      nameZh: "后侧墙体模块",
      nameEn: "Back wall module",
      type: ComponentType.WALL,
      zone: "SHELL",
      system: "STRUCTURE",
      layer: 2,
      step: 3,
      materialName: "保温夹芯墙板",
      dimensions: "6000 × 2500 × 160 mm（含窗洞）",
      taskCode: "T03",
      supportedBy: [FLOOR_ID],
    });

    const frontGroup = this.buildFrontWallWithDoor(-1.9);
    const front = this.addComponent(frontGroup, {
      id: "WR-WALL-FRONT",
      nameZh: "前侧墙体模块",
      nameEn: "Front wall module",
      type: ComponentType.WALL,
      zone: "SHELL",
      system: "STRUCTURE",
      layer: 2,
      step: 3,
      materialName: "保温夹芯墙板",
      dimensions: "6000 × 2500 × 160 mm（含门洞）",
      taskCode: "T03",
      supportedBy: [FLOOR_ID],
    });

    return { left, right, back, front };
  }

  private buildDoorAndWindows(walls: { left: string; right: string; back: string; front: string }): {
    door: string;
    backWindow: string;
    sideWindow: string;
  } {
    const door = this.addComponent(this.makeDoor(-1.9, FLOOR_TOP + 1.025, DEPTH / 2 - 0.11), {
      id: "WR-DOOR-01",
      nameZh: "入户门",
      nameEn: "Entry door",
      type: ComponentType.ENCLOSURE,
      zone: "SHELL",
      system: "ENCLOSURE",
      layer: 3,
      step: 5,
      materialName: "钢制保温门",
      dimensions: "950 × 2050 × 60 mm",
      taskCode: "T05",
      parentIds: [walls.front],
      supportedBy: [walls.front],
      connectedTo: [walls.front],
    });

    const backWindow = this.addComponent(this.makeWindow(1.25, FLOOR_TOP + 1.55, -DEPTH / 2 + 0.09, 0), {
      id: "WR-WINDOW-BACK",
      nameZh: "后墙采光窗",
      nameEn: "Back daylight window",
      type: ComponentType.ENCLOSURE,
      zone: "SHELL",
      system: "ENCLOSURE",
      layer: 3,
      step: 5,
      materialName: "铝合金中空玻璃窗",
      dimensions: "1400 × 1000 mm",
      taskCode: "T05",
      parentIds: [walls.back],
      supportedBy: [walls.back],
      connectedTo: [walls.back],
    });

    const sideWindow = this.addComponent(
      this.makeWindow(WIDTH / 2 - 0.09, FLOOR_TOP + 1.55, 1.0, Math.PI / 2),
      {
        id: "WR-WINDOW-SIDE",
        nameZh: "侧墙通风窗",
        nameEn: "Side ventilation window",
        type: ComponentType.ENCLOSURE,
        zone: "SHELL",
        system: "ENCLOSURE",
        layer: 3,
        step: 5,
        materialName: "铝合金中空玻璃窗",
        dimensions: "1400 × 1000 mm",
        taskCode: "T05",
        parentIds: [walls.right],
        supportedBy: [walls.right],
        connectedTo: [walls.right],
      },
    );

    return { door, backWindow, sideWindow };
  }

  private buildRoof(walls: { left: string; right: string; back: string; front: string }): { left: string; right: string } {
    const roofY = FLOOR_TOP + WALL_HEIGHT + 0.11;
    const supports = [walls.left, walls.right, walls.back, walls.front];

    const left = this.addComponent(this.box(3.12, 0.2, 3.84, -1.54, roofY, 0, this.materials.roof), {
      id: "WR-ROOF-L",
      nameZh: "左侧屋顶模块",
      nameEn: "Left roof cassette",
      type: ComponentType.ROOF_PANEL,
      zone: "SHELL",
      system: "STRUCTURE",
      layer: 4,
      step: 4,
      materialName: "轻钢保温屋面板",
      dimensions: "3120 × 3840 × 200 mm",
      taskCode: "T04",
      supportedBy: supports,
      connectedTo: ["WR-ROOF-R"],
    });

    const right = this.addComponent(this.box(3.12, 0.2, 3.84, 1.54, roofY, 0, this.materials.roof), {
      id: "WR-ROOF-R",
      nameZh: "右侧屋顶模块",
      nameEn: "Right roof cassette",
      type: ComponentType.ROOF_PANEL,
      zone: "SHELL",
      system: "STRUCTURE",
      layer: 4,
      step: 4,
      materialName: "轻钢保温屋面板",
      dimensions: "3120 × 3840 × 200 mm",
      taskCode: "T04",
      supportedBy: supports,
      connectedTo: [left],
    });

    return { left, right };
  }

  private buildLivingFixtures(roofs: { left: string; right: string }): void {
    this.addComponent(this.makeBed(-1.85, -0.7), {
      id: "WR-BED-01",
      nameZh: "单人床 A",
      nameEn: "Single bed A",
      type: ComponentType.FIXTURE,
      zone: "LIVING",
      system: "FURNITURE",
      layer: 5,
      step: 6,
      materialName: "钢木组合床",
      dimensions: "2000 × 900 × 650 mm",
      taskCode: "T06",
      supportedBy: [FLOOR_ID],
    });

    this.addComponent(this.makeBed(1.85, -0.7), {
      id: "WR-BED-02",
      nameZh: "单人床 B",
      nameEn: "Single bed B",
      type: ComponentType.FIXTURE,
      zone: "LIVING",
      system: "FURNITURE",
      layer: 5,
      step: 6,
      materialName: "钢木组合床",
      dimensions: "2000 × 900 × 650 mm",
      taskCode: "T06",
      supportedBy: [FLOOR_ID],
    });

    this.addComponent(this.makeLocker(0, -1.38), {
      id: "WR-LOCKER-01",
      nameZh: "双人储物柜",
      nameEn: "Two-person locker",
      type: ComponentType.FIXTURE,
      zone: "LIVING",
      system: "FURNITURE",
      layer: 5,
      step: 6,
      materialName: "喷涂钢板",
      dimensions: "900 × 450 × 1800 mm",
      taskCode: "T06",
      supportedBy: [FLOOR_ID],
    });

    this.addComponent(this.makeTable(0, 0.65), {
      id: "WR-TABLE-01",
      nameZh: "共用桌",
      nameEn: "Shared table",
      type: ComponentType.FIXTURE,
      zone: "LIVING",
      system: "FURNITURE",
      layer: 5,
      step: 6,
      materialName: "钢木组合",
      dimensions: "1200 × 650 × 750 mm",
      taskCode: "T06",
      supportedBy: [FLOOR_ID],
    });

    this.addComponent(this.makeCeilingLight(0, FLOOR_TOP + WALL_HEIGHT - 0.12, 0.25), {
      id: "WR-LIGHT-01",
      nameZh: "顶棚照明灯",
      nameEn: "Ceiling light",
      type: ComponentType.FIXTURE,
      zone: "LIVING",
      system: "ELECTRICAL",
      layer: 5,
      step: 6,
      materialName: "LED 吸顶灯",
      dimensions: "直径 420 mm",
      taskCode: "T06",
      parentIds: [roofs.left, roofs.right],
      supportedBy: [roofs.left],
      connectedTo: [roofs.left, roofs.right],
    });
  }

  private finalizeConnections(): void {
    this.components.forEach(({ data }) => {
      const ids = [...data.connectedTo, ...data.supportedBy, ...data.parentIds];
      ids.forEach((id) => {
        const related = this.componentMap.get(id);
        if (!related) return;
        if (!related.data.connectedTo.includes(data.componentId)) {
          related.data.connectedTo.push(data.componentId);
        }
      });
    });
  }

  private buildSideWallWithWindow(windowZ: number): THREE.Group {
    const group = new THREE.Group();
    const x = WIDTH / 2 - WALL_THICKNESS / 2;
    const wallY = FLOOR_TOP + WALL_HEIGHT / 2;
    const opening = { width: 1.4, height: 1, sill: 1.05 };
    const lowerHeight = opening.sill;
    const upperHeight = WALL_HEIGHT - opening.sill - opening.height;
    const frontDepth = DEPTH / 2 + windowZ - opening.width / 2;
    const backDepth = DEPTH / 2 - windowZ - opening.width / 2;

    group.add(this.box(WALL_THICKNESS, lowerHeight, opening.width, x, FLOOR_TOP + lowerHeight / 2, windowZ, this.materials.wall));
    group.add(
      this.box(
        WALL_THICKNESS,
        upperHeight,
        opening.width,
        x,
        FLOOR_TOP + opening.sill + opening.height + upperHeight / 2,
        windowZ,
        this.materials.wall,
      ),
    );
    group.add(this.box(WALL_THICKNESS, WALL_HEIGHT, frontDepth, x, wallY, windowZ + opening.width / 2 + frontDepth / 2, this.materials.wall));
    group.add(this.box(WALL_THICKNESS, WALL_HEIGHT, backDepth, x, wallY, windowZ - opening.width / 2 - backDepth / 2, this.materials.wall));
    return group;
  }

  private buildBackWallWithWindow(windowX: number): THREE.Group {
    const group = new THREE.Group();
    const z = -DEPTH / 2 + WALL_THICKNESS / 2;
    const wallY = FLOOR_TOP + WALL_HEIGHT / 2;
    const opening = { width: 1.4, height: 1, sill: 1.05 };
    const lowerHeight = opening.sill;
    const upperHeight = WALL_HEIGHT - opening.sill - opening.height;
    const leftWidth = WIDTH / 2 + windowX - opening.width / 2;
    const rightWidth = WIDTH / 2 - windowX - opening.width / 2;

    group.add(this.box(opening.width, lowerHeight, WALL_THICKNESS, windowX, FLOOR_TOP + lowerHeight / 2, z, this.materials.wall));
    group.add(
      this.box(
        opening.width,
        upperHeight,
        WALL_THICKNESS,
        windowX,
        FLOOR_TOP + opening.sill + opening.height + upperHeight / 2,
        z,
        this.materials.wall,
      ),
    );
    group.add(this.box(leftWidth, WALL_HEIGHT, WALL_THICKNESS, -WIDTH / 2 + leftWidth / 2, wallY, z, this.materials.wall));
    group.add(this.box(rightWidth, WALL_HEIGHT, WALL_THICKNESS, windowX + opening.width / 2 + rightWidth / 2, wallY, z, this.materials.wall));
    return group;
  }

  private buildFrontWallWithDoor(doorX: number): THREE.Group {
    const group = new THREE.Group();
    const z = DEPTH / 2 - WALL_THICKNESS / 2;
    const wallY = FLOOR_TOP + WALL_HEIGHT / 2;
    const doorWidth = 0.95;
    const doorHeight = 2.05;
    const leftWidth = WIDTH / 2 + doorX - doorWidth / 2;
    const rightWidth = WIDTH / 2 - doorX - doorWidth / 2;
    const headerHeight = WALL_HEIGHT - doorHeight;

    group.add(this.box(leftWidth, WALL_HEIGHT, WALL_THICKNESS, -WIDTH / 2 + leftWidth / 2, wallY, z, this.materials.wall));
    group.add(this.box(rightWidth, WALL_HEIGHT, WALL_THICKNESS, doorX + doorWidth / 2 + rightWidth / 2, wallY, z, this.materials.wall));
    group.add(
      this.box(
        doorWidth,
        headerHeight,
        WALL_THICKNESS,
        doorX,
        FLOOR_TOP + doorHeight + headerHeight / 2,
        z,
        this.materials.wall,
      ),
    );
    return group;
  }

  private makeDoor(x: number, y: number, z: number): THREE.Group {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    group.add(this.box(0.9, 2.0, 0.06, 0, 0, 0, this.materials.timber));
    const handle = new THREE.Mesh(new THREE.SphereGeometry(0.045, 14, 10), this.materials.metal);
    handle.position.set(0.32, 0, -0.055);
    group.add(handle);
    return group;
  }

  private makeWindow(x: number, y: number, z: number, rotationY: number): THREE.Group {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    group.rotation.y = rotationY;
    const frame = 0.07;
    group.add(this.box(1.4, frame, 0.08, 0, 0.5 - frame / 2, 0, this.materials.metal));
    group.add(this.box(1.4, frame, 0.08, 0, -0.5 + frame / 2, 0, this.materials.metal));
    group.add(this.box(frame, 1.0, 0.08, -0.7 + frame / 2, 0, 0, this.materials.metal));
    group.add(this.box(frame, 1.0, 0.08, 0.7 - frame / 2, 0, 0, this.materials.metal));
    group.add(this.box(frame, 1.0, 0.08, 0, 0, 0, this.materials.metal));
    group.add(this.box(1.26, 0.86, 0.025, 0, 0, 0, this.materials.glass));
    return group;
  }

  private makeBed(x: number, z: number): THREE.Group {
    const group = new THREE.Group();
    group.position.set(x, FLOOR_TOP + 0.28, z);
    group.add(this.box(2.0, 0.16, 0.9, 0, 0, 0, this.materials.metal));
    group.add(this.box(1.92, 0.18, 0.82, 0, 0.17, 0, this.materials.mattress));
    group.add(this.box(0.12, 0.62, 0.9, -0.94, 0.22, 0, this.materials.timber));
    group.add(this.box(0.48, 0.08, 0.62, -0.58, 0.31, 0, this.materials.textile));
    return group;
  }

  private makeLocker(x: number, z: number): THREE.Group {
    const group = new THREE.Group();
    group.position.set(x, FLOOR_TOP + 0.9, z);
    group.add(this.box(0.9, 1.8, 0.45, 0, 0, 0, this.materials.metal));
    group.add(this.box(0.025, 1.7, 0.46, 0, 0, 0.235, this.materials.wallEdge));
    group.add(this.box(0.025, 1.7, 0.025, 0, 0, 0.27, this.materials.metal));
    return group;
  }

  private makeTable(x: number, z: number): THREE.Group {
    const group = new THREE.Group();
    group.position.set(x, FLOOR_TOP, z);
    group.add(this.box(1.2, 0.09, 0.65, 0, 0.705, 0, this.materials.timber));
    const legPositions = [
      [-0.5, 0.33, -0.23],
      [0.5, 0.33, -0.23],
      [-0.5, 0.33, 0.23],
      [0.5, 0.33, 0.23],
    ] as const;
    legPositions.forEach(([lx, ly, lz]) => group.add(this.box(0.07, 0.66, 0.07, lx, ly, lz, this.materials.metal)));
    return group;
  }

  private makeCeilingLight(x: number, y: number, z: number): THREE.Group {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    const fixture = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.07, 28), this.materials.light);
    group.add(fixture);
    const point = new THREE.PointLight(0xffd98a, 4.5, 8, 2);
    point.position.set(0, -0.2, 0);
    group.add(point);
    return group;
  }

  private box(
    width: number,
    height: number,
    depth: number,
    x: number,
    y: number,
    z: number,
    material: THREE.Material,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.set(x, y, z);
    return mesh;
  }
}
