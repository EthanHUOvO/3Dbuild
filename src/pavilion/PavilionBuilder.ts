import * as THREE from "three";
import {
  ComponentStatus,
  ComponentType,
  type TempleComponent,
  type TempleComponentData,
  type TempleModel,
} from "../temple/componentTypes";

interface ComponentSpec {
  id: string;
  nameZh: string;
  nameEn: string;
  type: ComponentType;
  layer: number;
  step: number;
  parentIds?: string[];
  connectedTo?: string[];
  supportedBy?: string[];
}

const OCTAGON_SIDES = 8;
const COLUMN_RADIUS = 4.75;
const EAVE_RADIUS = 6.65;
const EAVE_Y = 7.62;
const EAVE_PURLIN_Y = 8.5;
const APEX_Y = 10.65;

export interface PavilionSupportReport {
  valid: number;
  total: number;
  invalidIds: string[];
}

export interface PavilionBearingReport {
  valid: number;
  total: number;
  invalidIds: string[];
}

/**
 * A deliberately abstract octagonal timber pavilion.
 *
 * The model is not a survey reconstruction. Its hierarchy is arranged so every
 * non-ground component has a data-driven support path:
 * platform → bases → columns → ring/cross beams → dougong/kingpost →
 * radial rafters → roof panels → ridges/finial.
 */
export class PavilionBuilder {
  private readonly root = new THREE.Group();
  private readonly components: TempleComponent[] = [];
  private readonly componentMap = new Map<string, TempleComponent>();

  private readonly materials = {
    stone: new THREE.MeshStandardMaterial({ color: 0xb9beb6, roughness: 0.9, metalness: 0.02 }),
    stoneDark: new THREE.MeshStandardMaterial({ color: 0x747d78, roughness: 0.94 }),
    red: new THREE.MeshStandardMaterial({ color: 0x9b352d, roughness: 0.68 }),
    redBright: new THREE.MeshStandardMaterial({ color: 0xc35a3f, roughness: 0.63 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x6f4931, roughness: 0.79 }),
    woodLight: new THREE.MeshStandardMaterial({ color: 0xa06d47, roughness: 0.73 }),
    teal: new THREE.MeshStandardMaterial({ color: 0x2f8877, roughness: 0.61 }),
    tealDark: new THREE.MeshStandardMaterial({ color: 0x1c5d54, roughness: 0.72 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xc4933e, roughness: 0.53, metalness: 0.11 }),
    roof: new THREE.MeshStandardMaterial({
      color: 0x315f5b,
      roughness: 0.76,
      metalness: 0.04,
      side: THREE.DoubleSide,
    }),
    roofAlt: new THREE.MeshStandardMaterial({
      color: 0x3d706a,
      roughness: 0.74,
      side: THREE.DoubleSide,
    }),
  };

  build(): TempleModel {
    this.root.name = "Abstract Octagonal Timber Pavilion";
    this.buildFoundation();
    const grid = this.buildBasesAndColumns();
    const beams = this.buildBeamFrame(grid.columns);
    const dougong = this.buildDougong(grid.columns, beams.ring);
    const eavePurlins = this.buildEavePurlins(dougong);
    const kingpost = this.buildKingpost(beams.cross);
    const rafters = this.buildRafters(eavePurlins, kingpost);
    const panels = this.buildRoofPanels(rafters);
    const ridges = this.buildRidges(panels);
    this.buildRailings(grid.columns);
    this.buildFinial(ridges);
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
        missingDougongId: dougong[0],
        dougongAffectedRoofId: panels[0],
        missingBeamId: beams.ring[0],
        beamAffectedRoofId: panels[1],
      },
    };
  }

  static validateSupportPaths(model: TempleModel): PavilionSupportReport {
    const groundRoot = "PAV-FND-01";
    const memo = new Map<string, boolean>();

    const reachesGround = (id: string, visiting: Set<string>): boolean => {
      if (id === groundRoot) return true;
      if (memo.has(id)) return memo.get(id)!;
      if (visiting.has(id)) return false;
      const component = model.componentMap.get(id);
      if (!component || component.data.supportedBy.length === 0) return false;
      const nextVisiting = new Set(visiting).add(id);
      const valid = component.data.supportedBy.some((supportId) => reachesGround(supportId, nextVisiting));
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

  static validateBearingContacts(model: TempleModel): PavilionBearingReport {
    model.root.updateMatrixWorld(true);
    const rafters = model.components.filter(({ data }) => data.componentType === ComponentType.RAFTER);
    const invalidIds = rafters
      .filter(({ object, data }) => {
        const rafterBounds = new THREE.Box3().setFromObject(object).expandByScalar(0.025);
        const bearingPurlins = data.supportedBy
          .map((id) => model.componentMap.get(id))
          .filter((component): component is TempleComponent => component?.data.componentType === ComponentType.PURLIN);
        return !bearingPurlins.some(({ object: purlin }) =>
          rafterBounds.intersectsBox(new THREE.Box3().setFromObject(purlin).expandByScalar(0.025)),
        );
      })
      .map(({ data }) => data.componentId);

    return {
      valid: rafters.length - invalidIds.length,
      total: rafters.length,
      invalidIds,
    };
  }

  private addComponent(object: THREE.Object3D, spec: ComponentSpec): string {
    const originalPosition = object.position.clone();
    const explodedPosition = originalPosition.clone().add(this.explosionOffset(spec.type, originalPosition, spec.id));
    const data: TempleComponentData = {
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
    };
    object.userData.componentData = data;
    object.name = `${spec.id} · ${spec.nameZh}`;
    this.root.add(object);
    const component = { object, data };
    this.components.push(component);
    this.componentMap.set(spec.id, component);
    return spec.id;
  }

  private explosionOffset(type: ComponentType, position: THREE.Vector3, id: string): THREE.Vector3 {
    const radial = new THREE.Vector3(position.x, 0, position.z);
    if (radial.lengthSq() < 0.05) {
      const index = Number(id.match(/\d+/)?.[0] ?? 1);
      radial.set(Math.cos(index * 1.7), 0, Math.sin(index * 1.7));
    }
    radial.normalize();

    switch (type) {
      case ComponentType.FOUNDATION: {
        const course = Number(id.match(/(\d+)$/)?.[1] ?? 1);
        return new THREE.Vector3(radial.x * course * 1.25, -course * 0.18, radial.z * course * 1.25);
      }
      case ComponentType.COLUMN_BASE:
        return radial.multiplyScalar(2.7).add(new THREE.Vector3(0, -0.7, 0));
      case ComponentType.COLUMN:
        if (id === "PAV-KINGPOST-01") return new THREE.Vector3(0, 6.8, 0);
        return radial.multiplyScalar(4.1).add(new THREE.Vector3(0, 0.6, 0));
      case ComponentType.BEAM:
        return radial.multiplyScalar(5.1).add(new THREE.Vector3(0, 2.5, 0));
      case ComponentType.DOUGONG:
        return radial.multiplyScalar(6.4).add(new THREE.Vector3(0, 4.2, 0));
      case ComponentType.RAFTER:
        return radial.multiplyScalar(8.1).add(new THREE.Vector3(0, 7.2, 0));
      case ComponentType.ROOF_PANEL:
        return radial.multiplyScalar(10.2).add(new THREE.Vector3(0, 10.2, 0));
      case ComponentType.RIDGE:
        return radial.multiplyScalar(id.includes("FINIAL") ? 0.8 : 11.2).add(
          new THREE.Vector3(0, id.includes("FINIAL") ? 15.3 : 13.1, 0),
        );
      case ComponentType.ENCLOSURE:
        return radial.multiplyScalar(6.2).add(new THREE.Vector3(0, 1.2, 0));
      case ComponentType.PURLIN:
        return radial.multiplyScalar(6).add(new THREE.Vector3(0, 5.8, 0));
      default:
        return radial.multiplyScalar(5).add(new THREE.Vector3(0, 3, 0));
    }
  }

  private buildFoundation(): void {
    const levels = [
      { id: "PAV-FND-01", radius: 6.4, height: 0.6, y: 0.05, name: "八角下层台基", support: [] as string[] },
      { id: "PAV-FND-02", radius: 5.95, height: 0.38, y: 0.52, name: "八角束腰层", support: ["PAV-FND-01"] },
      { id: "PAV-FND-03", radius: 5.62, height: 0.28, y: 0.84, name: "八角台明", support: ["PAV-FND-02"] },
    ];

    levels.forEach((level, index) => {
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(level.radius, level.radius + (index === 0 ? 0.18 : 0), level.height, 8),
        index === 1 ? this.materials.stoneDark : this.materials.stone,
      );
      mesh.position.y = level.y;
      this.addComponent(mesh, {
        id: level.id,
        nameZh: level.name,
        nameEn: ["Lower octagonal terrace", "Recessed stone course", "Upper octagonal platform"][index],
        type: ComponentType.FOUNDATION,
        layer: 0,
        step: 1,
        supportedBy: level.support,
        connectedTo: level.support,
      });
    });
  }

  private buildBasesAndColumns(): { bases: string[]; columns: string[] } {
    const bases: string[] = [];
    const columns: string[] = [];
    this.octagonPoints(COLUMN_RADIUS, 1.16).forEach((point, index) => {
      const suffix = String(index + 1).padStart(2, "0");
      const baseId = `PAV-BASE-${suffix}`;
      const base = new THREE.Group();
      const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.67, 0.34, 12), this.materials.stone);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.54, 0.14, 12), this.materials.stoneDark);
      cap.position.y = 0.22;
      base.add(lower, cap);
      base.position.copy(point);
      this.addComponent(base, {
        id: baseId,
        nameZh: `第${index + 1}柱础`,
        nameEn: `Column base ${index + 1}`,
        type: ComponentType.COLUMN_BASE,
        layer: 1,
        step: 2,
        supportedBy: ["PAV-FND-03"],
        connectedTo: ["PAV-FND-03"],
      });
      bases.push(baseId);

      const columnId = `PAV-COL-${suffix}`;
      const column = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.38, 5.72, 14), this.materials.red);
      column.position.set(point.x, 4.22, point.z);
      this.addComponent(column, {
        id: columnId,
        nameZh: `第${index + 1}檐柱`,
        nameEn: `Perimeter timber column ${index + 1}`,
        type: ComponentType.COLUMN,
        layer: 2,
        step: 3,
        parentIds: [baseId],
        supportedBy: [baseId],
        connectedTo: [baseId],
      });
      columns.push(columnId);
    });
    return { bases, columns };
  }

  private buildBeamFrame(columns: string[]): { ring: string[]; cross: string[] } {
    const points = this.octagonPoints(COLUMN_RADIUS, 7.18);
    const ring: string[] = [];
    for (let index = 0; index < OCTAGON_SIDES; index += 1) {
      const next = (index + 1) % OCTAGON_SIDES;
      const id = `PAV-RING-${String(index + 1).padStart(2, "0")}`;
      const beam = this.boxBetween(points[index], points[next], 0.42, 0.48, this.materials.redBright);
      this.addComponent(beam, {
        id,
        nameZh: `第${index + 1}段八角圈梁`,
        nameEn: `Octagonal ring beam ${index + 1}`,
        type: ComponentType.BEAM,
        layer: 3,
        step: 4,
        parentIds: [columns[index], columns[next]],
        supportedBy: [columns[index], columns[next]],
        connectedTo: [columns[index], columns[next]],
      });
      ring.push(id);
    }

    const cross: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      const opposite = index + 4;
      const start = points[index].clone().setY(7.56);
      const end = points[opposite].clone().setY(7.56);
      const id = `PAV-CROSS-${String(index + 1).padStart(2, "0")}`;
      const beam = this.boxBetween(start, end, 0.32, 0.34, this.materials.wood);
      this.addComponent(beam, {
        id,
        nameZh: `第${index + 1}根对角承托梁`,
        nameEn: `Diametral support beam ${index + 1}`,
        type: ComponentType.BEAM,
        layer: 3,
        step: 4,
        supportedBy: [columns[index], columns[opposite], ring[index], ring[(index + 7) % 8]],
        connectedTo: [columns[index], columns[opposite]],
      });
      cross.push(id);
    }
    return { ring, cross };
  }

  private buildDougong(columns: string[], ring: string[]): string[] {
    return this.octagonPoints(COLUMN_RADIUS, 7.72).map((point, index) => {
      const group = new THREE.Group();
      const block = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.35, 0.72), this.materials.gold);
      block.position.y = -0.21;
      const armTangential = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.22, 0.4), this.materials.teal);
      armTangential.position.y = 0.08;
      const armRadial = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.22, 1.2), this.materials.redBright);
      armRadial.position.y = 0.36;
      const cap = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.18, 0.52), this.materials.tealDark);
      cap.position.y = 0.62;
      group.add(block, armTangential, armRadial, cap);
      group.position.copy(point);
      group.rotation.y = -index * (Math.PI / 4);

      const id = `PAV-DG-${String(index + 1).padStart(2, "0")}`;
      this.addComponent(group, {
        id,
        nameZh: `第${index + 1}组柱头斗拱`,
        nameEn: `Column-head bracket set ${index + 1}`,
        type: ComponentType.DOUGONG,
        layer: 4,
        step: 5,
        parentIds: [columns[index]],
        supportedBy: [columns[index], ring[index], ring[(index + 7) % 8]],
        connectedTo: [columns[index], ring[index], ring[(index + 7) % 8]],
      });
      return id;
    });
  }

  private buildEavePurlins(dougong: string[]): string[] {
    const points = this.octagonPoints(COLUMN_RADIUS, EAVE_PURLIN_Y);
    const purlins: string[] = [];
    for (let index = 0; index < OCTAGON_SIDES; index += 1) {
      const next = (index + 1) % OCTAGON_SIDES;
      const id = `PAV-PURLIN-${String(index + 1).padStart(2, "0")}`;
      const purlin = this.boxBetween(points[index], points[next], 0.24, 0.3, this.materials.wood);
      this.addComponent(purlin, {
        id,
        nameZh: `第${index + 1}段八角檐檩`,
        nameEn: `Octagonal eave purlin ${index + 1}`,
        type: ComponentType.PURLIN,
        layer: 5,
        step: 6,
        parentIds: [dougong[index], dougong[next]],
        supportedBy: [dougong[index], dougong[next]],
        connectedTo: [dougong[index], dougong[next]],
      });
      purlins.push(id);
    }
    return purlins;
  }

  private buildKingpost(crossBeams: string[]): string {
    const group = new THREE.Group();
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.36, 2.55, 12), this.materials.red);
    const lowerBlock = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.3, 0.82), this.materials.gold);
    lowerBlock.position.y = -1.28;
    const topBlock = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.28, 0.72), this.materials.teal);
    topBlock.position.y = 1.28;
    group.add(post, lowerBlock, topBlock);
    group.position.set(0, 8.96, 0);
    this.addComponent(group, {
      id: "PAV-KINGPOST-01",
      nameZh: "中央雷公柱",
      nameEn: "Central kingpost",
      type: ComponentType.COLUMN,
      layer: 5,
      step: 6,
      parentIds: crossBeams,
      supportedBy: crossBeams,
      connectedTo: crossBeams,
    });
    return "PAV-KINGPOST-01";
  }

  private buildRafters(eavePurlins: string[], kingpost: string): string[] {
    const rafters: string[] = [];
    for (let index = 0; index < 16; index += 1) {
      const angle = (Math.PI * 2 * index) / 16 + Math.PI / 8;
      const isMain = index % 2 === 0;
      const outerRadius = isMain ? EAVE_RADIUS + 0.24 : EAVE_RADIUS;
      const start = new THREE.Vector3(
        Math.cos(angle) * outerRadius,
        EAVE_Y + (isMain ? 0.08 : 0),
        Math.sin(angle) * outerRadius,
      );
      const end = new THREE.Vector3(0, APEX_Y - 0.18, 0);
      const id = `PAV-RAFTER-${String(index + 1).padStart(2, "0")}`;
      const rafter = this.cylinderBetween(
        start,
        end,
        isMain ? 0.14 : 0.1,
        isMain ? this.materials.woodLight : this.materials.wood,
        8,
      );
      const bracketIndex = Math.floor(index / 2) % 8;
      const bearingPurlins = isMain
        ? [eavePurlins[(bracketIndex + 7) % 8], eavePurlins[bracketIndex]]
        : [eavePurlins[bracketIndex]];
      this.addComponent(rafter, {
        id,
        nameZh: isMain ? `第${bracketIndex + 1}根角梁` : `第${bracketIndex + 1}根放射椽`,
        nameEn: isMain ? `Principal hip rafter ${bracketIndex + 1}` : `Intermediate radial rafter ${bracketIndex + 1}`,
        type: ComponentType.RAFTER,
        layer: 6,
        step: 7,
        parentIds: [...bearingPurlins, kingpost],
        supportedBy: [...bearingPurlins, kingpost],
        connectedTo: [...bearingPurlins, kingpost],
      });
      rafters.push(id);
    }
    return rafters;
  }

  private buildRoofPanels(rafters: string[]): string[] {
    const vertices = this.octagonPoints(EAVE_RADIUS + 0.2, EAVE_Y + 0.11, Math.PI / 8);
    const apex = new THREE.Vector3(0, APEX_Y, 0);
    const panels: string[] = [];
    for (let index = 0; index < OCTAGON_SIDES; index += 1) {
      const next = (index + 1) % OCTAGON_SIDES;
      const points = [vertices[index], vertices[next], apex];
      const center = points.reduce((sum, point) => sum.add(point), new THREE.Vector3()).multiplyScalar(1 / 3);
      const positions = new Float32Array(
        points.flatMap((point) => [point.x - center.x, point.y - center.y, point.z - center.z]),
      );
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geometry.setIndex([0, 1, 2]);
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, index % 2 === 0 ? this.materials.roof : this.materials.roofAlt);
      mesh.position.copy(center);
      const id = `PAV-ROOF-${String(index + 1).padStart(2, "0")}`;
      const boundaryRafter = rafters[index * 2];
      const middleRafter = rafters[index * 2 + 1];
      const nextBoundaryRafter = rafters[(next * 2) % 16];
      this.addComponent(mesh, {
        id,
        nameZh: `第${index + 1}片攒尖瓦面`,
        nameEn: `Pyramidal roof sector ${index + 1}`,
        type: ComponentType.ROOF_PANEL,
        layer: 7,
        step: 8,
        parentIds: [boundaryRafter, middleRafter, nextBoundaryRafter],
        supportedBy: [boundaryRafter, middleRafter, nextBoundaryRafter],
        connectedTo: [boundaryRafter, middleRafter, nextBoundaryRafter],
      });
      panels.push(id);
    }
    return panels;
  }

  private buildRidges(panels: string[]): string[] {
    const vertices = this.octagonPoints(EAVE_RADIUS + 0.26, EAVE_Y + 0.26, Math.PI / 8);
    const apex = new THREE.Vector3(0, APEX_Y + 0.12, 0);
    return vertices.map((end, index) => {
      const ridge = this.cylinderBetween(apex, end, 0.16, this.materials.gold, 8);
      const id = `PAV-RIDGE-${String(index + 1).padStart(2, "0")}`;
      this.addComponent(ridge, {
        id,
        nameZh: `第${index + 1}条垂脊`,
        nameEn: `Hip ridge ${index + 1}`,
        type: ComponentType.RIDGE,
        layer: 8,
        step: 9,
        supportedBy: [panels[index], panels[(index + 7) % 8]],
        connectedTo: [panels[index], panels[(index + 7) % 8]],
      });
      return id;
    });
  }

  private buildRailings(columns: string[]): void {
    const points = this.octagonPoints(COLUMN_RADIUS, 0);
    for (let index = 0; index < OCTAGON_SIDES; index += 1) {
      const next = (index + 1) % OCTAGON_SIDES;
      const start = points[index];
      const end = points[next];
      const length = start.distanceTo(end);
      const group = new THREE.Group();
      const top = new THREE.Mesh(new THREE.BoxGeometry(length - 0.72, 0.16, 0.16), this.materials.teal);
      top.position.y = 0.82;
      const bottom = new THREE.Mesh(new THREE.BoxGeometry(length - 0.72, 0.13, 0.15), this.materials.wood);
      bottom.position.y = -0.05;
      group.add(top, bottom);
      for (let baluster = -2; baluster <= 2; baluster += 1) {
        const vertical = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.82, 0.12), this.materials.redBright);
        vertical.position.set((baluster * (length - 1.1)) / 5, 0.39, 0);
        group.add(vertical);
      }
      const midpoint = start.clone().add(end).multiplyScalar(0.5);
      group.position.set(midpoint.x, 1.82, midpoint.z);
      const direction = end.clone().sub(start);
      group.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), direction.normalize());
      const id = `PAV-RAIL-${String(index + 1).padStart(2, "0")}`;
      this.addComponent(group, {
        id,
        nameZh: `第${index + 1}面坐凳栏杆`,
        nameEn: `Perimeter railing bay ${index + 1}`,
        type: ComponentType.ENCLOSURE,
        layer: 2,
        step: 3,
        parentIds: [columns[index], columns[next]],
        supportedBy: [columns[index], columns[next], "PAV-FND-03"],
        connectedTo: [columns[index], columns[next]],
      });
    }
  }

  private buildFinial(ridges: string[]): void {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.62, 0.38, 12), this.materials.gold);
    base.position.set(0, APEX_Y + 0.23, 0);
    this.addComponent(base, {
      id: "PAV-FINIAL-01",
      nameZh: "宝顶承座",
      nameEn: "Finial base",
      type: ComponentType.RIDGE,
      layer: 9,
      step: 10,
      supportedBy: ridges,
      connectedTo: ridges,
    });

    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.26, 1.05, 12), this.materials.gold);
    stem.position.set(0, APEX_Y + 0.94, 0);
    this.addComponent(stem, {
      id: "PAV-FINIAL-02",
      nameZh: "宝顶刹杆",
      nameEn: "Finial stem",
      type: ComponentType.RIDGE,
      layer: 9,
      step: 10,
      parentIds: ["PAV-FINIAL-01"],
      supportedBy: ["PAV-FINIAL-01"],
      connectedTo: ["PAV-FINIAL-01"],
    });

    const pearl = new THREE.Mesh(new THREE.SphereGeometry(0.42, 18, 14), this.materials.gold);
    pearl.position.set(0, APEX_Y + 1.67, 0);
    this.addComponent(pearl, {
      id: "PAV-FINIAL-03",
      nameZh: "宝顶宝珠",
      nameEn: "Finial pearl",
      type: ComponentType.RIDGE,
      layer: 9,
      step: 10,
      parentIds: ["PAV-FINIAL-02"],
      supportedBy: ["PAV-FINIAL-02"],
      connectedTo: ["PAV-FINIAL-02"],
    });
  }

  private finalizeConnections(): void {
    this.components.forEach(({ data }) => {
      data.supportedBy.forEach((supportId) => {
        const support = this.componentMap.get(supportId);
        if (!support) throw new Error(`Unknown support ${supportId} referenced by ${data.componentId}`);
        if (!data.connectedTo.includes(supportId)) data.connectedTo.push(supportId);
        if (!support.data.connectedTo.includes(data.componentId)) {
          support.data.connectedTo.push(data.componentId);
        }
      });
      data.connectedTo = [...new Set(data.connectedTo)];
      data.supportedBy = [...new Set(data.supportedBy)];
    });
  }

  private octagonPoints(radius: number, y: number, rotation = Math.PI / 8): THREE.Vector3[] {
    return Array.from({ length: OCTAGON_SIDES }, (_, index) => {
      const angle = (Math.PI * 2 * index) / OCTAGON_SIDES + rotation;
      return new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
    });
  }

  private boxBetween(
    start: THREE.Vector3,
    end: THREE.Vector3,
    height: number,
    depth: number,
    material: THREE.Material,
  ): THREE.Mesh {
    const direction = end.clone().sub(start);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(direction.length(), height, depth), material);
    mesh.position.copy(start).add(end).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), direction.normalize());
    return mesh;
  }

  private cylinderBetween(
    start: THREE.Vector3,
    end: THREE.Vector3,
    radius: number,
    material: THREE.Material,
    segments = 10,
  ): THREE.Mesh {
    const direction = end.clone().sub(start);
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius * 1.08, direction.length(), segments),
      material,
    );
    mesh.position.copy(start).add(end).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    return mesh;
  }
}
