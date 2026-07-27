import * as THREE from "three";
import {
  ComponentStatus,
  ComponentType,
  type TempleComponent,
  type TempleComponentData,
  type TempleModel,
} from "../temple/componentTypes";

export type RestroomZone = "MALE" | "FEMALE" | "SHARED";
export type RestroomSystem =
  | "STRUCTURE"
  | "ENCLOSURE"
  | "SANITARY"
  | "VENTILATION"
  | "PLUMBING"
  | "WAYFINDING";
export type VentilationRole = "INTAKE" | "TRANSFER" | "EXHAUST" | "ROOF_OUTLET" | "NATURAL_OUTLET";

export interface RestroomComponentData extends TempleComponentData {
  zone: RestroomZone;
  system: RestroomSystem;
  ventilationRole?: VentilationRole;
}

interface ComponentSpec {
  id: string;
  nameZh: string;
  nameEn: string;
  type: ComponentType;
  zone: RestroomZone;
  system: RestroomSystem;
  layer: number;
  step: number;
  parentIds?: string[];
  connectedTo?: string[];
  supportedBy?: string[];
  ventilationRole?: VentilationRole;
}

export interface RestroomSupportReport {
  valid: number;
  total: number;
  invalidIds: string[];
}

export interface ZoneVentilationReport {
  zone: Exclude<RestroomZone, "SHARED">;
  status: "PASS" | "INVALID";
  intakeIds: string[];
  outletIds: string[];
  path: string[];
}

export interface RestroomVentilationReport {
  valid: number;
  total: number;
  zones: ZoneVentilationReport[];
}

export interface RestroomProgramReport {
  maleToilets: number;
  maleUrinals: number;
  maleBasins: number;
  femaleToilets: number;
  femaleBasins: number;
  separatedZones: boolean;
}

const ROOT_ID = "WC-FND-01";
const MALE_FLOOR = "WC-FLR-M-01";
const FEMALE_FLOOR = "WC-FLR-F-01";

/**
 * A programmatic, deliberately abstract public-restroom prototype.
 *
 * It demonstrates spatial separation and ventilation logic rather than
 * claiming regulatory certification for a particular jurisdiction.
 */
export class RestroomBuilder {
  private readonly root = new THREE.Group();
  private readonly components: TempleComponent[] = [];
  private readonly componentMap = new Map<string, TempleComponent>();

  private readonly materials = {
    concrete: new THREE.MeshStandardMaterial({ color: 0xc7c7be, roughness: 0.92, metalness: 0.01 }),
    floorMale: new THREE.MeshStandardMaterial({ color: 0x839b98, roughness: 0.88 }),
    floorFemale: new THREE.MeshStandardMaterial({ color: 0xb39b90, roughness: 0.88 }),
    wall: new THREE.MeshStandardMaterial({ color: 0xe4e2da, roughness: 0.84 }),
    wallDark: new THREE.MeshStandardMaterial({ color: 0x313b3a, roughness: 0.72 }),
    partition: new THREE.MeshStandardMaterial({ color: 0x566762, roughness: 0.68 }),
    door: new THREE.MeshStandardMaterial({ color: 0x9e7654, roughness: 0.72 }),
    timber: new THREE.MeshStandardMaterial({ color: 0xb68456, roughness: 0.7 }),
    porcelain: new THREE.MeshStandardMaterial({ color: 0xf2f1ea, roughness: 0.35, metalness: 0.02 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x9fa9a6, roughness: 0.34, metalness: 0.7 }),
    teal: new THREE.MeshStandardMaterial({
      color: 0x22c8bc,
      emissive: 0x0b5b57,
      emissiveIntensity: 0.45,
      roughness: 0.42,
    }),
    blue: new THREE.MeshStandardMaterial({ color: 0x547e96, roughness: 0.46, metalness: 0.16 }),
    charcoal: new THREE.MeshStandardMaterial({ color: 0x222b2a, roughness: 0.64 }),
    signage: new THREE.MeshStandardMaterial({
      color: 0xe0b659,
      emissive: 0x5b4312,
      emissiveIntensity: 0.3,
      roughness: 0.52,
    }),
    airflow: new THREE.MeshStandardMaterial({
      color: 0x54eadc,
      emissive: 0x26b9ad,
      emissiveIntensity: 1.15,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      roughness: 0.25,
    }),
  };

  build(): TempleModel {
    this.root.name = "Minimal Public Restroom Assembly";
    this.buildFoundationAndFloors();
    const wallIds = this.buildWalls();
    const roofIds = this.buildRoofs(wallIds);
    this.buildCubiclesAndFixtures();
    this.buildPlumbing();
    this.buildPrivacyAndWayfinding();
    this.buildVentilation(wallIds.rear, wallIds.side, roofIds);
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
        missingDougongId: "WC-VENT-M-FAN",
        dougongAffectedRoofId: roofIds.male,
        missingBeamId: "WC-WALL-C-02",
        beamAffectedRoofId: roofIds.female,
      },
    };
  }

  static validateSupportPaths(model: TempleModel): RestroomSupportReport {
    const memo = new Map<string, boolean>();
    const reachesGround = (id: string, visiting: Set<string>): boolean => {
      if (id === ROOT_ID) return true;
      if (memo.has(id)) return memo.get(id)!;
      if (visiting.has(id)) return false;
      const component = model.componentMap.get(id);
      if (!component || component.data.supportedBy.length === 0) return false;
      const next = new Set(visiting).add(id);
      const valid = component.data.supportedBy.some((supportId) => reachesGround(supportId, next));
      memo.set(id, valid);
      return valid;
    };
    const invalidIds = model.components
      .filter(({ data }) => !reachesGround(data.componentId, new Set()))
      .map(({ data }) => data.componentId);
    return {
      valid: model.components.length - invalidIds.length,
      total: model.components.length,
      invalidIds,
    };
  }

  static validateVentilation(model: TempleModel): RestroomVentilationReport {
    const zones: ZoneVentilationReport[] = (["MALE", "FEMALE"] as const).map((zone) => {
      const zoneComponents = model.components.filter(({ data }) => {
        const restroomData = data as RestroomComponentData;
        return restroomData.system === "VENTILATION" && (restroomData.zone === zone || restroomData.zone === "SHARED");
      });
      const intakeIds = zoneComponents
        .filter(({ data }) => (data as RestroomComponentData).ventilationRole === "INTAKE")
        .map(({ data }) => data.componentId);
      const outletIds = zoneComponents
        .filter(({ data }) => (data as RestroomComponentData).ventilationRole === "ROOF_OUTLET")
        .map(({ data }) => data.componentId);

      const queue = intakeIds.map((id) => ({ id, path: [id] }));
      const visited = new Set(intakeIds);
      let path: string[] = [];
      while (queue.length > 0 && path.length === 0) {
        const current = queue.shift()!;
        if (outletIds.includes(current.id)) {
          path = current.path;
          break;
        }
        const component = model.componentMap.get(current.id);
        component?.data.connectedTo.forEach((nextId) => {
          if (visited.has(nextId)) return;
          const next = model.componentMap.get(nextId);
          if (!next) return;
          const nextData = next.data as RestroomComponentData;
          if (nextData.system !== "VENTILATION" || (nextData.zone !== zone && nextData.zone !== "SHARED")) return;
          visited.add(nextId);
          queue.push({ id: nextId, path: [...current.path, nextId] });
        });
      }

      return {
        zone,
        status: path.length > 0 ? "PASS" : "INVALID",
        intakeIds,
        outletIds,
        path,
      };
    });
    return { valid: zones.filter(({ status }) => status === "PASS").length, total: zones.length, zones };
  }

  static getProgramReport(model: TempleModel): RestroomProgramReport {
    const count = (zone: RestroomZone, token: string) =>
      model.components.filter(({ data }) => {
        const restroomData = data as RestroomComponentData;
        return restroomData.zone === zone && data.componentId.includes(token);
      }).length;
    const centerWalls = model.components.filter(({ data }) => data.componentId.startsWith("WC-WALL-C-"));
    return {
      maleToilets: count("MALE", "-WC-"),
      maleUrinals: count("MALE", "-URI-"),
      maleBasins: count("MALE", "-BASIN-"),
      femaleToilets: count("FEMALE", "-WC-"),
      femaleBasins: count("FEMALE", "-BASIN-"),
      separatedZones: centerWalls.length === 4,
    };
  }

  private addComponent(object: THREE.Object3D, spec: ComponentSpec): string {
    const originalPosition = object.position.clone();
    const explodedPosition = originalPosition.clone().add(this.explosionOffset(spec, originalPosition));
    const data: RestroomComponentData = {
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
      ventilationRole: spec.ventilationRole,
    };
    object.userData.componentData = data;
    object.name = `${spec.id} · ${spec.nameZh}`;
    this.root.add(object);
    const component = { object, data };
    this.components.push(component);
    this.componentMap.set(spec.id, component);
    return spec.id;
  }

  private explosionOffset(spec: ComponentSpec, objectPosition: THREE.Vector3): THREE.Vector3 {
    const direction = spec.zone === "MALE" ? -1 : spec.zone === "FEMALE" ? 1 : spec.id.length % 2 ? -1 : 1;
    const frontBack = objectPosition.z >= 0 ? 1 : -1;
    switch (spec.type) {
      case ComponentType.FOUNDATION:
        return new THREE.Vector3(0, -2.3, 0);
      case ComponentType.FLOOR:
        return new THREE.Vector3(direction * 7.5, -1.1, 0);
      case ComponentType.WALL:
        if (spec.id.startsWith("WC-WALL-C-")) return new THREE.Vector3(0, 5.6, frontBack * 1.2);
        return new THREE.Vector3(direction * 7.8, 2.2, frontBack * 3.4);
      case ComponentType.PARTITION:
        return new THREE.Vector3(direction * 10.3, 4.2, frontBack * 2.1);
      case ComponentType.FIXTURE:
        return new THREE.Vector3(direction * 12.2, 2.1, frontBack * 2.8);
      case ComponentType.PLUMBING:
        return new THREE.Vector3(direction * 8.6, -1.8, -6.1);
      case ComponentType.VENTILATION:
        return new THREE.Vector3(direction * 8.9, 9.1, -7.3);
      case ComponentType.ROOF_PANEL:
        return new THREE.Vector3(direction * 6.5, 12.8, 0);
      case ComponentType.SCREEN:
        return new THREE.Vector3(direction * 9.3, 3.2, 7.7);
      case ComponentType.SIGNAGE:
        return new THREE.Vector3(direction * 11.1, 6.2, 8.9);
      default:
        return new THREE.Vector3(direction * 6, 3, frontBack * 3);
    }
  }

  private buildFoundationAndFloors(): void {
    this.addComponent(this.box(12.8, 0.36, 8.8, 0, 0, 0, this.materials.concrete), {
      id: ROOT_ID,
      nameZh: "整体混凝土基础",
      nameEn: "Monolithic concrete foundation",
      type: ComponentType.FOUNDATION,
      zone: "SHARED",
      system: "STRUCTURE",
      layer: 0,
      step: 1,
    });
    this.addComponent(this.box(5.9, 0.16, 8.05, -3, 0.27, 0, this.materials.floorMale), {
      id: MALE_FLOOR,
      nameZh: "男厕防滑地坪模块",
      nameEn: "Male anti-slip floor module",
      type: ComponentType.FLOOR,
      zone: "MALE",
      system: "STRUCTURE",
      layer: 1,
      step: 2,
      supportedBy: [ROOT_ID],
    });
    this.addComponent(this.box(5.9, 0.16, 8.05, 3, 0.27, 0, this.materials.floorFemale), {
      id: FEMALE_FLOOR,
      nameZh: "女厕防滑地坪模块",
      nameEn: "Female anti-slip floor module",
      type: ComponentType.FLOOR,
      zone: "FEMALE",
      system: "STRUCTURE",
      layer: 1,
      step: 2,
      supportedBy: [ROOT_ID],
    });
  }

  private buildWalls(): {
    side: Record<"MALE" | "FEMALE", string[]>;
    rear: Record<"MALE" | "FEMALE", string[]>;
    central: string[];
    front: Record<"MALE" | "FEMALE", string[]>;
  } {
    const side: Record<"MALE" | "FEMALE", string[]> = { MALE: [], FEMALE: [] };
    (["MALE", "FEMALE"] as const).forEach((zone) => {
      const x = zone === "MALE" ? -6 : 6;
      const floor = zone === "MALE" ? MALE_FLOOR : FEMALE_FLOOR;
      [-2, 2].forEach((z, index) => {
        const id = `WC-WALL-${zone[0]}-SIDE-${index + 1}`;
        this.addComponent(this.box(0.24, 3.25, 4.02, x, 1.96, z, this.materials.wall), {
          id,
          nameZh: `${zone === "MALE" ? "男厕" : "女厕"}侧墙模块 ${index + 1}`,
          nameEn: `${zone.toLowerCase()} side wall module ${index + 1}`,
          type: ComponentType.WALL,
          zone,
          system: "ENCLOSURE",
          layer: 2,
          step: 3,
          supportedBy: [floor],
        });
        side[zone].push(id);
      });
    });

    const rear: Record<"MALE" | "FEMALE", string[]> = { MALE: [], FEMALE: [] };
    (["MALE", "FEMALE"] as const).forEach((zone) => {
      const floor = zone === "MALE" ? MALE_FLOOR : FEMALE_FLOOR;
      const centers = zone === "MALE" ? [-5, -3, -1] : [1, 3, 5];
      centers.forEach((x, index) => {
        const id = `WC-WALL-${zone[0]}-REAR-${index + 1}`;
        this.addComponent(this.box(1.92, 2.28, 0.24, x, 1.43, -4, this.materials.wall), {
          id,
          nameZh: `${zone === "MALE" ? "男厕" : "女厕"}后墙下部模块 ${index + 1}`,
          nameEn: `${zone.toLowerCase()} lower rear wall module ${index + 1}`,
          type: ComponentType.WALL,
          zone,
          system: "ENCLOSURE",
          layer: 2,
          step: 3,
          supportedBy: [floor],
        });
        rear[zone].push(id);
      });
    });

    const front: Record<"MALE" | "FEMALE", string[]> = { MALE: [], FEMALE: [] };
    const frontSpecs = [
      { zone: "MALE" as const, x: -4.9, width: 2.2 },
      { zone: "MALE" as const, x: -1.1, width: 2.2 },
      { zone: "FEMALE" as const, x: 1.1, width: 2.2 },
      { zone: "FEMALE" as const, x: 4.9, width: 2.2 },
    ];
    frontSpecs.forEach(({ zone, x, width }, index) => {
      const floor = zone === "MALE" ? MALE_FLOOR : FEMALE_FLOOR;
      const zoneIndex = front[zone].length + 1;
      const id = `WC-WALL-${zone[0]}-FRONT-${zoneIndex}`;
      this.addComponent(this.box(width, 3.22, 0.24, x, 1.95, 4, this.materials.wall), {
        id,
        nameZh: `${zone === "MALE" ? "男厕" : "女厕"}入口侧墙 ${zoneIndex}`,
        nameEn: `${zone.toLowerCase()} entrance wall ${zoneIndex}`,
        type: ComponentType.WALL,
        zone,
        system: "ENCLOSURE",
        layer: 2,
        step: 3,
        supportedBy: [floor],
      });
      front[zone].push(id);
      void index;
    });

    const central: string[] = [];
    [-3, -1, 1, 3].forEach((z, index) => {
      const id = `WC-WALL-C-${String(index + 1).padStart(2, "0")}`;
      this.addComponent(this.box(0.3, 3.3, 2.02, 0, 1.98, z, this.materials.wallDark), {
        id,
        nameZh: `男女厕实体分隔墙 ${index + 1}`,
        nameEn: `Solid gender separation wall ${index + 1}`,
        type: ComponentType.WALL,
        zone: "SHARED",
        system: "ENCLOSURE",
        layer: 2,
        step: 3,
        supportedBy: [ROOT_ID],
      });
      central.push(id);
    });
    return { side, rear, central, front };
  }

  private buildRoofs(walls: ReturnType<RestroomBuilder["buildWalls"]>): { male: string; female: string } {
    const commonSupports = [
      walls.central[0],
      walls.central[3],
      walls.side.MALE[0],
      walls.side.MALE[1],
      walls.side.FEMALE[0],
      walls.side.FEMALE[1],
    ];
    const male = this.addComponent(this.box(6.3, 0.3, 8.6, -3.1, 3.78, 0, this.materials.charcoal), {
      id: "WC-ROOF-M-01",
      nameZh: "男厕平屋面模块",
      nameEn: "Male flat-roof module",
      type: ComponentType.ROOF_PANEL,
      zone: "MALE",
      system: "STRUCTURE",
      layer: 7,
      step: 8,
      supportedBy: [...commonSupports.slice(0, 2), ...walls.side.MALE, ...walls.rear.MALE],
    });
    const female = this.addComponent(this.box(6.3, 0.3, 8.6, 3.1, 3.78, 0, this.materials.charcoal), {
      id: "WC-ROOF-F-01",
      nameZh: "女厕平屋面模块",
      nameEn: "Female flat-roof module",
      type: ComponentType.ROOF_PANEL,
      zone: "FEMALE",
      system: "STRUCTURE",
      layer: 7,
      step: 8,
      supportedBy: [...commonSupports.slice(0, 2), ...walls.side.FEMALE, ...walls.rear.FEMALE],
    });
    return { male, female };
  }

  private buildCubiclesAndFixtures(): void {
    const maleBoundaries = [-5.6, -4, -2.4, -0.8];
    maleBoundaries.forEach((x, index) => {
      this.addPartition(`WC-PART-M-${index + 1}`, x, -2.82, 0.12, 2.2, 2.08, "MALE", MALE_FLOOR);
    });
    [-4.8, -3.2, -1.6].forEach((x, index) => {
      this.addDoor(`WC-DOOR-M-${index + 1}`, x, -1.76, 1.34, 1.88, "MALE", maleBoundaries[index + 1]);
      this.addToilet(`WC-FIX-M-WC-${index + 1}`, x, -3.22, "MALE", MALE_FLOOR);
    });

    const femaleBoundaries = [0.4, 1.5, 2.6, 3.7, 4.8, 5.9];
    femaleBoundaries.forEach((x, index) => {
      this.addPartition(`WC-PART-F-${index + 1}`, x, -2.82, 0.11, 2.2, 2.08, "FEMALE", FEMALE_FLOOR);
    });
    [0.95, 2.05, 3.15, 4.25, 5.35].forEach((x, index) => {
      this.addDoor(`WC-DOOR-F-${index + 1}`, x, -1.76, 0.89, 1.88, "FEMALE", femaleBoundaries[index + 1]);
      this.addToilet(`WC-FIX-F-WC-${index + 1}`, x, -3.22, "FEMALE", FEMALE_FLOOR);
    });

    [-0.8, 0.55, 1.9].forEach((z, index) => {
      this.addUrinal(`WC-FIX-M-URI-${index + 1}`, -5.68, z, MALE_FLOOR);
    });
    [0.2, 1.35, 2.5].forEach((z, index) => {
      this.addBasin(`WC-FIX-M-BASIN-${index + 1}`, -0.55, z, "MALE", MALE_FLOOR);
      this.addBasin(`WC-FIX-F-BASIN-${index + 1}`, 0.55, z, "FEMALE", FEMALE_FLOOR);
    });
  }

  private buildPlumbing(): void {
    (["MALE", "FEMALE"] as const).forEach((zone) => {
      const direction = zone === "MALE" ? -1 : 1;
      const floor = zone === "MALE" ? MALE_FLOOR : FEMALE_FLOOR;
      const chaseId = `WC-PLUMB-${zone[0]}-CHASE`;
      const chase = new THREE.Group();
      chase.add(new THREE.Mesh(new THREE.BoxGeometry(0.42, 2.6, 1.35), this.materials.blue));
      const water = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 2.25, 10), this.materials.teal);
      water.position.x = direction * 0.1;
      const waste = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 2.25, 10), this.materials.charcoal);
      waste.position.x = -direction * 0.1;
      chase.add(water, waste);
      chase.position.set(direction * 0.34, 1.58, -3.25);
      this.addComponent(chase, {
        id: chaseId,
        nameZh: `${zone === "MALE" ? "男厕" : "女厕"}竖向管井`,
        nameEn: `${zone.toLowerCase()} vertical plumbing chase`,
        type: ComponentType.PLUMBING,
        zone,
        system: "PLUMBING",
        layer: 3,
        step: 4,
        supportedBy: [floor],
      });

      const collector = this.box(4.9, 0.16, 0.18, direction * 3.1, 0.48, -3.58, this.materials.blue);
      this.addComponent(collector, {
        id: `WC-PLUMB-${zone[0]}-COLLECTOR`,
        nameZh: `${zone === "MALE" ? "男厕" : "女厕"}横向排水汇集管`,
        nameEn: `${zone.toLowerCase()} waste collector`,
        type: ComponentType.PLUMBING,
        zone,
        system: "PLUMBING",
        layer: 3,
        step: 4,
        supportedBy: [floor],
        connectedTo: [chaseId],
      });
    });
  }

  private buildPrivacyAndWayfinding(): void {
    (["MALE", "FEMALE"] as const).forEach((zone) => {
      const direction = zone === "MALE" ? -1 : 1;
      const floor = zone === "MALE" ? MALE_FLOOR : FEMALE_FLOOR;
      const screenId = `WC-SCREEN-${zone[0]}-01`;
      const screen = new THREE.Group();
      for (let index = -4; index <= 4; index += 1) {
        const slat = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.7, 0.22), this.materials.timber);
        slat.position.x = index * 0.28;
        screen.add(slat);
      }
      const rail = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.13, 0.26), this.materials.charcoal);
      rail.position.y = 1.29;
      screen.add(rail);
      screen.position.set(direction * 3, 1.72, 4.85);
      this.addComponent(screen, {
        id: screenId,
        nameZh: `${zone === "MALE" ? "男厕" : "女厕"}入口视线遮挡屏风`,
        nameEn: `${zone.toLowerCase()} entrance privacy screen`,
        type: ComponentType.SCREEN,
        zone,
        system: "ENCLOSURE",
        layer: 3,
        step: 4,
        supportedBy: [floor],
      });

      const returnScreen = this.box(0.15, 2.35, 1.45, direction * 4.18, 1.55, 4.4, this.materials.timber);
      this.addComponent(returnScreen, {
        id: `WC-SCREEN-${zone[0]}-02`,
        nameZh: `${zone === "MALE" ? "男厕" : "女厕"}入口折返屏`,
        nameEn: `${zone.toLowerCase()} entrance return screen`,
        type: ComponentType.SCREEN,
        zone,
        system: "ENCLOSURE",
        layer: 3,
        step: 4,
        supportedBy: [floor],
        connectedTo: [screenId],
      });

      const sign = new THREE.Mesh(new THREE.CircleGeometry(0.29, 24), this.materials.signage);
      sign.position.set(direction * 3, 2.02, 4.99);
      this.addComponent(sign, {
        id: `WC-SIGN-${zone[0]}-01`,
        nameZh: zone === "MALE" ? "男厕导视标识" : "女厕导视标识",
        nameEn: zone === "MALE" ? "Male wayfinding sign" : "Female wayfinding sign",
        type: ComponentType.SIGNAGE,
        zone,
        system: "WAYFINDING",
        layer: 5,
        step: 6,
        supportedBy: [screenId],
      });
    });
  }

  private buildVentilation(
    rearWalls: Record<"MALE" | "FEMALE", string[]>,
    sideWalls: Record<"MALE" | "FEMALE", string[]>,
    roofs: { male: string; female: string },
  ): void {
    (["MALE", "FEMALE"] as const).forEach((zone) => {
      const direction = zone === "MALE" ? -1 : 1;
      const centers = zone === "MALE" ? [-5, -3, -1] : [1, 3, 5];
      centers.forEach((x, index) => {
        const louver = this.louver(1.55, 0.55, 5, this.materials.teal);
        louver.position.set(x, 2.9, -3.96);
        this.addComponent(louver, {
          id: `WC-VENT-${zone[0]}-LOUVER-${index + 1}`,
          nameZh: `${zone === "MALE" ? "男厕" : "女厕"}高位自然排风百叶 ${index + 1}`,
          nameEn: `${zone.toLowerCase()} high-level exhaust louver ${index + 1}`,
          type: ComponentType.VENTILATION,
          zone,
          system: "VENTILATION",
          ventilationRole: "NATURAL_OUTLET",
          layer: 6,
          step: 7,
          supportedBy: [rearWalls[zone][index]],
        });
      });

      const intakeIds: string[] = [];
      [1.1, 2.45].forEach((z, index) => {
        const grille = this.louver(0.8, 0.5, 4, this.materials.teal);
        grille.rotation.y = Math.PI / 2;
        grille.position.set(direction * 5.96, 0.82, z);
        const id = `WC-VENT-${zone[0]}-INTAKE-${index + 1}`;
        this.addComponent(grille, {
          id,
          nameZh: `${zone === "MALE" ? "男厕" : "女厕"}低位补风格栅 ${index + 1}`,
          nameEn: `${zone.toLowerCase()} low-level make-up air grille ${index + 1}`,
          type: ComponentType.VENTILATION,
          zone,
          system: "VENTILATION",
          ventilationRole: "INTAKE",
          layer: 6,
          step: 7,
          supportedBy: [sideWalls[zone][1]],
        });
        intakeIds.push(id);
      });

      const fanId = `WC-VENT-${zone[0]}-FAN`;
      const fan = this.exhaustFan();
      fan.position.set(direction * 3.05, 3.0, -3.72);
      this.addComponent(fan, {
        id: fanId,
        nameZh: `${zone === "MALE" ? "男厕" : "女厕"}机械排风机`,
        nameEn: `${zone.toLowerCase()} mechanical exhaust fan`,
        type: ComponentType.VENTILATION,
        zone,
        system: "VENTILATION",
        ventilationRole: "EXHAUST",
        layer: 6,
        step: 7,
        supportedBy: [rearWalls[zone][1]],
      });

      const ductId = `WC-VENT-${zone[0]}-DUCT`;
      const duct = this.cylinderBetween(
        new THREE.Vector3(direction * 3.05, 3.05, -3.56),
        new THREE.Vector3(direction * 3.05, 4.28, -2.9),
        0.18,
        this.materials.metal,
        14,
      );
      this.addComponent(duct, {
        id: ductId,
        nameZh: `${zone === "MALE" ? "男厕" : "女厕"}排风竖管`,
        nameEn: `${zone.toLowerCase()} exhaust riser duct`,
        type: ComponentType.VENTILATION,
        zone,
        system: "VENTILATION",
        ventilationRole: "TRANSFER",
        layer: 6,
        step: 7,
        supportedBy: [fanId],
        connectedTo: [fanId],
      });

      const roofVentId = `WC-VENT-${zone[0]}-ROOF`;
      const roofVent = new THREE.Group();
      const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.85, 16), this.materials.metal);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.25, 0.18, 16), this.materials.charcoal);
      cap.position.y = 0.5;
      roofVent.add(stack, cap);
      roofVent.position.set(direction * 3.05, 4.28, -2.9);
      this.addComponent(roofVent, {
        id: roofVentId,
        nameZh: `${zone === "MALE" ? "男厕" : "女厕"}屋顶排风帽`,
        nameEn: `${zone.toLowerCase()} roof exhaust cowl`,
        type: ComponentType.VENTILATION,
        zone,
        system: "VENTILATION",
        ventilationRole: "ROOF_OUTLET",
        layer: 8,
        step: 9,
        supportedBy: [zone === "MALE" ? roofs.male : roofs.female],
        connectedTo: [ductId],
      });

      const intakeFlowId = `WC-AIR-${zone[0]}-LOW`;
      const intakeFlow = this.airflowArrow([
        new THREE.Vector3(direction * 5.45, 0.95, 2.1),
        new THREE.Vector3(direction * 4.1, 1.15, 1.2),
        new THREE.Vector3(direction * 3.2, 1.35, 0.1),
      ]);
      this.addComponent(intakeFlow, {
        id: intakeFlowId,
        nameZh: `${zone === "MALE" ? "男厕" : "女厕"}低位补风路径`,
        nameEn: `${zone.toLowerCase()} make-up airflow path`,
        type: ComponentType.VENTILATION,
        zone,
        system: "VENTILATION",
        ventilationRole: "TRANSFER",
        layer: 6,
        step: 7,
        supportedBy: intakeIds,
        connectedTo: [...intakeIds],
      });

      const exhaustFlowId = `WC-AIR-${zone[0]}-HIGH`;
      const exhaustFlow = this.airflowArrow([
        new THREE.Vector3(direction * 3.2, 1.35, 0.1),
        new THREE.Vector3(direction * 3.1, 2.45, -1.5),
        new THREE.Vector3(direction * 3.05, 2.95, -3.4),
      ]);
      this.addComponent(exhaustFlow, {
        id: exhaustFlowId,
        nameZh: `${zone === "MALE" ? "男厕" : "女厕"}高位排风路径`,
        nameEn: `${zone.toLowerCase()} high-level exhaust path`,
        type: ComponentType.VENTILATION,
        zone,
        system: "VENTILATION",
        ventilationRole: "TRANSFER",
        layer: 6,
        step: 7,
        supportedBy: [intakeFlowId],
        connectedTo: [intakeFlowId, fanId],
      });

      const fanComponent = this.componentMap.get(fanId);
      if (fanComponent) fanComponent.data.connectedTo.push(exhaustFlowId, ductId);
      const ductComponent = this.componentMap.get(ductId);
      if (ductComponent) ductComponent.data.connectedTo.push(roofVentId);
    });
  }

  private addPartition(
    id: string,
    x: number,
    z: number,
    width: number,
    height: number,
    depth: number,
    zone: "MALE" | "FEMALE",
    floor: string,
  ): void {
    this.addComponent(this.box(width, height, depth, x, 1.52, z, this.materials.partition), {
      id,
      nameZh: `${zone === "MALE" ? "男厕" : "女厕"}厕位隔板 ${id.split("-").at(-1)}`,
      nameEn: `${zone.toLowerCase()} cubicle partition ${id.split("-").at(-1)}`,
      type: ComponentType.PARTITION,
      zone,
      system: "ENCLOSURE",
      layer: 4,
      step: 5,
      supportedBy: [floor],
    });
  }

  private addDoor(
    id: string,
    x: number,
    z: number,
    width: number,
    height: number,
    zone: "MALE" | "FEMALE",
    partitionX: number,
  ): void {
    const door = this.box(width, height, 0.1, x, 1.48, z, this.materials.door);
    this.addComponent(door, {
      id,
      nameZh: `${zone === "MALE" ? "男厕" : "女厕"}厕位门 ${id.split("-").at(-1)}`,
      nameEn: `${zone.toLowerCase()} cubicle door ${id.split("-").at(-1)}`,
      type: ComponentType.PARTITION,
      zone,
      system: "ENCLOSURE",
      layer: 4,
      step: 5,
      supportedBy: [zone === "MALE" ? MALE_FLOOR : FEMALE_FLOOR],
      connectedTo: [this.nearestPartitionId(zone, partitionX)],
    });
  }

  private addToilet(id: string, x: number, z: number, zone: "MALE" | "FEMALE", floor: string): void {
    const group = new THREE.Group();
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.3, 0.42, 16), this.materials.porcelain);
    pedestal.position.y = 0.21;
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.28, 0.18, 18), this.materials.porcelain);
    bowl.scale.z = 1.25;
    bowl.position.set(0, 0.46, 0.08);
    const tank = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.62, 0.24), this.materials.porcelain);
    tank.position.set(0, 0.66, -0.28);
    const seat = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.035, 8, 22), this.materials.charcoal);
    seat.scale.z = 1.2;
    seat.rotation.x = Math.PI / 2;
    seat.position.set(0, 0.57, 0.09);
    group.add(pedestal, bowl, tank, seat);
    group.position.set(x, 0.38, z);
    this.addComponent(group, {
      id,
      nameZh: `${zone === "MALE" ? "男厕" : "女厕"}坐便器 ${id.split("-").at(-1)}`,
      nameEn: `${zone.toLowerCase()} water closet ${id.split("-").at(-1)}`,
      type: ComponentType.FIXTURE,
      zone,
      system: "SANITARY",
      layer: 5,
      step: 6,
      supportedBy: [floor],
      connectedTo: [`WC-PLUMB-${zone[0]}-COLLECTOR`],
    });
  }

  private addUrinal(id: string, x: number, z: number, floor: string): void {
    const group = new THREE.Group();
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.62, 14), this.materials.porcelain);
    bowl.scale.z = 0.58;
    bowl.rotation.z = -Math.PI / 2;
    const sensor = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.12), this.materials.metal);
    sensor.position.set(0.08, 0.37, 0);
    group.add(bowl, sensor);
    group.position.set(x, 1.05, z);
    this.addComponent(group, {
      id,
      nameZh: `男厕感应小便器 ${id.split("-").at(-1)}`,
      nameEn: `Male sensor urinal ${id.split("-").at(-1)}`,
      type: ComponentType.FIXTURE,
      zone: "MALE",
      system: "SANITARY",
      layer: 5,
      step: 6,
      supportedBy: [floor],
      connectedTo: ["WC-PLUMB-M-COLLECTOR"],
    });
  }

  private addBasin(id: string, x: number, z: number, zone: "MALE" | "FEMALE", floor: string): void {
    const group = new THREE.Group();
    const counter = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.14, 0.52), this.materials.porcelain);
    counter.position.y = 0.85;
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.82, 0.13), this.materials.metal);
    leg.position.y = 0.41;
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.12, 16), this.materials.porcelain);
    basin.position.y = 0.92;
    const faucet = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.26, 10), this.materials.metal);
    faucet.position.set(0, 1.04, -0.17);
    group.add(counter, leg, basin, faucet);
    group.position.set(x, 0.37, z);
    this.addComponent(group, {
      id,
      nameZh: `${zone === "MALE" ? "男厕" : "女厕"}洗手盆 ${id.split("-").at(-1)}`,
      nameEn: `${zone.toLowerCase()} wash basin ${id.split("-").at(-1)}`,
      type: ComponentType.FIXTURE,
      zone,
      system: "SANITARY",
      layer: 5,
      step: 6,
      supportedBy: [floor],
      connectedTo: [`WC-PLUMB-${zone[0]}-CHASE`],
    });
  }

  private nearestPartitionId(zone: "MALE" | "FEMALE", x: number): string {
    const boundaries = zone === "MALE" ? [-5.6, -4, -2.4, -0.8] : [0.4, 1.5, 2.6, 3.7, 4.8, 5.9];
    const index = boundaries.reduce(
      (best, value, currentIndex) => (Math.abs(value - x) < Math.abs(boundaries[best] - x) ? currentIndex : best),
      0,
    );
    return `WC-PART-${zone[0]}-${index + 1}`;
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

  private louver(width: number, height: number, count: number, material: THREE.Material): THREE.Group {
    const group = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(width + 0.14, height + 0.14, 0.11), this.materials.charcoal);
    group.add(frame);
    for (let index = 0; index < count; index += 1) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(width, 0.055, 0.16), material);
      slat.position.y = -height / 2 + ((index + 0.5) * height) / count;
      slat.rotation.x = -0.28;
      group.add(slat);
    }
    return group;
  }

  private exhaustFan(): THREE.Group {
    const group = new THREE.Group();
    const casing = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.72, 0.28), this.materials.charcoal);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.035, 8, 24), this.materials.teal);
    ring.rotation.x = Math.PI / 2;
    ring.position.z = 0.16;
    group.add(casing, ring);
    for (let index = 0; index < 4; index += 1) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.27, 0.035), this.materials.metal);
      blade.rotation.z = (Math.PI * index) / 2 + 0.42;
      blade.position.z = 0.17;
      group.add(blade);
    }
    return group;
  }

  private airflowArrow(points: THREE.Vector3[]): THREE.Group {
    const group = new THREE.Group();
    for (let index = 0; index < points.length - 1; index += 1) {
      group.add(this.cylinderBetween(points[index], points[index + 1], 0.065, this.materials.airflow, 10));
    }
    const end = points.at(-1)!;
    const previous = points.at(-2)!;
    const direction = end.clone().sub(previous).normalize();
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.42, 12), this.materials.airflow);
    head.position.copy(end);
    head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
    group.add(head);
    return group;
  }

  private cylinderBetween(
    start: THREE.Vector3,
    end: THREE.Vector3,
    radius: number,
    material: THREE.Material,
    segments = 12,
  ): THREE.Mesh {
    const direction = end.clone().sub(start);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, direction.length(), segments), material);
    mesh.position.copy(start).add(end).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    return mesh;
  }

  private finalizeConnections(): void {
    this.components.forEach(({ data }) => {
      data.supportedBy.forEach((supportId) => {
        const support = this.componentMap.get(supportId);
        if (!support) throw new Error(`Unknown support ${supportId} referenced by ${data.componentId}`);
        if (!data.connectedTo.includes(supportId)) data.connectedTo.push(supportId);
        if (!support.data.connectedTo.includes(data.componentId)) support.data.connectedTo.push(data.componentId);
      });
      data.connectedTo.forEach((id) => {
        if (!this.componentMap.has(id)) throw new Error(`Unknown connection ${id} referenced by ${data.componentId}`);
      });
      data.connectedTo = [...new Set(data.connectedTo)];
      data.supportedBy = [...new Set(data.supportedBy)];
    });
  }
}
