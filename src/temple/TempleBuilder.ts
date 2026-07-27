import * as THREE from "three";
import {
  ComponentStatus,
  ComponentType,
  type TempleComponent,
  type TempleComponentData,
  type TempleModel,
} from "./componentTypes";

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

export class TempleBuilder {
  private readonly root = new THREE.Group();
  private readonly components: TempleComponent[] = [];
  private readonly componentMap = new Map<string, TempleComponent>();

  private readonly materials = {
    stone: new THREE.MeshStandardMaterial({ color: 0xb9beb7, roughness: 0.88, metalness: 0.03 }),
    stoneDark: new THREE.MeshStandardMaterial({ color: 0x7f8883, roughness: 0.94 }),
    red: new THREE.MeshStandardMaterial({ color: 0x8f3029, roughness: 0.7 }),
    redBright: new THREE.MeshStandardMaterial({ color: 0xb64e36, roughness: 0.68 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x65432f, roughness: 0.8 }),
    woodLight: new THREE.MeshStandardMaterial({ color: 0x956447, roughness: 0.76 }),
    teal: new THREE.MeshStandardMaterial({ color: 0x287467, roughness: 0.62 }),
    tealDark: new THREE.MeshStandardMaterial({ color: 0x174f49, roughness: 0.74 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xb98732, roughness: 0.55, metalness: 0.12 }),
    roof: new THREE.MeshStandardMaterial({ color: 0x284c4b, roughness: 0.76, metalness: 0.05, side: THREE.DoubleSide }),
    roofAlt: new THREE.MeshStandardMaterial({ color: 0x345c59, roughness: 0.74, side: THREE.DoubleSide }),
    enclosure: new THREE.MeshStandardMaterial({ color: 0x547a70, roughness: 0.72 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1c2928, roughness: 0.82 }),
  };

  private readonly geometries = {
    column: new THREE.CylinderGeometry(0.32, 0.39, 5.7, 14),
    columnBase: new THREE.CylinderGeometry(0.55, 0.67, 0.44, 16),
    cap: new THREE.CylinderGeometry(0.5, 0.5, 0.13, 16),
    beamX: new THREE.BoxGeometry(3.95, 0.42, 0.46),
    beamZ: new THREE.BoxGeometry(0.42, 0.42, 3.62),
    rafter: new THREE.BoxGeometry(0.16, 0.18, 8.64),
  };

  build(): TempleModel {
    this.root.name = "Procedural Song-style Hall";
    this.buildFoundation();

    const grid = this.buildColumnGrid();
    const beamData = this.buildBeamFrames(grid);
    const dougongGrid = this.buildDougong(grid, beamData);
    const purlins = this.buildPurlins(dougongGrid);
    const rafters = this.buildRafters(purlins);
    const roofPanels = this.buildRoofPanels(rafters);
    this.buildRidges(roofPanels);
    this.buildEnclosure(grid);
    this.finalizeConnections();

    const missingDougongId = dougongGrid[2][3];
    const missingBeamId = beamData.x[2][2];
    const dgPurlin = purlins[4];
    const dgRafter = rafters.front[8];
    const dgRoof = roofPanels.front[16];
    const beamDougongId = dougongGrid[2][2];
    const beamPurlin = purlins[2];
    const beamRafter = rafters.back[10];
    const beamRoof = roofPanels.back[20];

    this.componentMap.get(dgPurlin)!.data.supportedBy = [missingDougongId];
    this.componentMap.get(dgRafter)!.data.supportedBy = [dgPurlin];
    this.componentMap.get(dgRoof)!.data.supportedBy = [dgRafter];

    this.componentMap.get(beamDougongId)!.data.supportedBy = [missingBeamId];
    this.componentMap.get(beamPurlin)!.data.supportedBy = [beamDougongId];
    this.componentMap.get(beamRafter)!.data.supportedBy = [beamPurlin];
    this.componentMap.get(beamRoof)!.data.supportedBy = [beamRafter];

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
        missingDougongId,
        dougongAffectedRoofId: dgRoof,
        missingBeamId,
        beamAffectedRoofId: beamRoof,
      },
    };
  }

  private addComponent(object: THREE.Object3D, spec: ComponentSpec): string {
    const originalPosition = object.position.clone();
    const explodedPosition = originalPosition.clone().add(this.explosionOffset(spec.type, originalPosition));
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

  private explosionOffset(type: ComponentType, position: THREE.Vector3): THREE.Vector3 {
    const radial = new THREE.Vector3(position.x, 0, position.z);
    if (radial.lengthSq() < 0.1) radial.set(0.35, 0, 0.2);
    radial.normalize();

    switch (type) {
      case ComponentType.FOUNDATION:
        return new THREE.Vector3(0, -1.6, 0);
      case ComponentType.COLUMN_BASE:
        return radial.multiplyScalar(3.5).add(new THREE.Vector3(0, -1.1, 0));
      case ComponentType.COLUMN:
        return radial.multiplyScalar(5.4).add(new THREE.Vector3(0, 0.8, 0));
      case ComponentType.BEAM:
        return radial.multiplyScalar(6.5).add(new THREE.Vector3(0, 2.8, 0));
      case ComponentType.ENCLOSURE:
        return radial.multiplyScalar(7.5).add(new THREE.Vector3(0, 1.8, 0));
      case ComponentType.DOUGONG:
        return radial.multiplyScalar(8).add(new THREE.Vector3(0, 4.5, 0));
      case ComponentType.PURLIN:
        return radial.multiplyScalar(4).add(new THREE.Vector3(0, 7.5, 0));
      case ComponentType.RAFTER:
        return new THREE.Vector3(radial.x * 4.2, 10.5, radial.z * 6.5);
      case ComponentType.ROOF_PANEL:
        return new THREE.Vector3(position.x * 0.14, 13, Math.sign(position.z || 1) * 10.5);
      case ComponentType.RIDGE:
        return new THREE.Vector3(position.x * 0.1, 17, position.z * 0.1);
      default:
        return radial.multiplyScalar(5).add(new THREE.Vector3(0, 3, 0));
    }
  }

  private buildFoundation(): void {
    const slabs = [
      { size: [24, 0.65, 15.5], y: 0.15, id: "FND-001", name: "下层须弥台" },
      { size: [22.7, 0.48, 14.2], y: 0.72, id: "FND-002", name: "中层台明" },
      { size: [21.7, 0.36, 13.2], y: 1.14, id: "FND-003", name: "上层压面石" },
    ];
    slabs.forEach(({ size, y, id, name }, index) => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size[0], size[1], size[2]),
        index === 1 ? this.materials.stoneDark : this.materials.stone,
      );
      mesh.position.set(0, y, 0);
      this.addComponent(mesh, {
        id,
        nameZh: name,
        nameEn: index === 0 ? "Lower stone platform" : "Stone terrace course",
        type: ComponentType.FOUNDATION,
        layer: 0,
        step: 1,
        supportedBy: index > 0 ? [`FND-00${index}`] : [],
      });
    });

    for (let i = 0; i < 7; i += 1) {
      const stair = new THREE.Mesh(new THREE.BoxGeometry(4.3 - i * 0.28, 0.18, 0.58), this.materials.stone);
      stair.position.set(0, 0.17 + i * 0.16, 8.05 - i * 0.45);
      this.addComponent(stair, {
        id: `FND-STAIR-${String(i + 1).padStart(2, "0")}`,
        nameZh: "御路踏步",
        nameEn: "Ceremonial stair",
        type: ComponentType.FOUNDATION,
        layer: 0,
        step: 1,
        supportedBy: ["FND-001"],
      });
    }
  }

  private buildColumnGrid(): { bases: string[][]; columns: string[][] } {
    const xs = [-10, -6, -2, 2, 6, 10];
    const zs = [-5.5, -1.85, 1.85, 5.5];
    const bases: string[][] = [];
    const columns: string[][] = [];

    zs.forEach((z, zi) => {
      bases[zi] = [];
      columns[zi] = [];
      xs.forEach((x, xi) => {
        const baseId = `BASE-Z${zi + 1}-X${xi + 1}`;
        const base = new THREE.Group();
        const lower = new THREE.Mesh(this.geometries.columnBase, this.materials.stone);
        const cap = new THREE.Mesh(this.geometries.cap, this.materials.stoneDark);
        cap.position.y = 0.25;
        base.add(lower, cap);
        base.position.set(x, 1.5, z);
        this.addComponent(base, {
          id: baseId,
          nameZh: `${this.gridName(xi, zi)}柱础`,
          nameEn: "Stone column base",
          type: ComponentType.COLUMN_BASE,
          layer: 1,
          step: 2,
          supportedBy: ["FND-003"],
          connectedTo: [`COL-Z${zi + 1}-X${xi + 1}`],
        });
        bases[zi][xi] = baseId;

        const columnId = `COL-Z${zi + 1}-X${xi + 1}`;
        const column = new THREE.Mesh(this.geometries.column, this.materials.red);
        column.position.set(x, 4.57, z);
        this.addComponent(column, {
          id: columnId,
          nameZh: `${this.gridName(xi, zi)}檐柱`,
          nameEn: "Timber column",
          type: ComponentType.COLUMN,
          layer: 2,
          step: 3,
          parentIds: [baseId],
          supportedBy: [baseId],
          connectedTo: [baseId],
        });
        columns[zi][xi] = columnId;
      });
    });
    return { bases, columns };
  }

  private buildBeamFrames(grid: { columns: string[][] }): { x: string[][]; z: string[][] } {
    const xs = [-10, -6, -2, 2, 6, 10];
    const zs = [-5.5, -1.85, 1.85, 5.5];
    const xBeams: string[][] = [];
    const zBeams: string[][] = [];

    zs.forEach((z, zi) => {
      xBeams[zi] = [];
      for (let xi = 0; xi < xs.length - 1; xi += 1) {
        const id = `BEAM-X-Z${zi + 1}-S${xi + 1}`;
        const beam = new THREE.Mesh(this.geometries.beamX, zi === 0 || zi === 3 ? this.materials.redBright : this.materials.wood);
        beam.position.set((xs[xi] + xs[xi + 1]) / 2, 7.37, z);
        const supports = [grid.columns[zi][xi], grid.columns[zi][xi + 1]];
        this.addComponent(beam, {
          id,
          nameZh: `${this.gridName(xi, zi)}横向额枋`,
          nameEn: "Transverse tie beam",
          type: ComponentType.BEAM,
          layer: 3,
          step: 4,
          supportedBy: supports,
          connectedTo: supports,
          parentIds: supports,
        });
        xBeams[zi][xi] = id;
      }
    });

    xs.forEach((x, xi) => {
      zBeams[xi] = [];
      for (let zi = 0; zi < zs.length - 1; zi += 1) {
        const id = `BEAM-Z-X${xi + 1}-S${zi + 1}`;
        const beam = new THREE.Mesh(this.geometries.beamZ, this.materials.wood);
        beam.position.set(x, 7.16, (zs[zi] + zs[zi + 1]) / 2);
        const supports = [grid.columns[zi][xi], grid.columns[zi + 1][xi]];
        this.addComponent(beam, {
          id,
          nameZh: `${this.gridName(xi, zi)}纵向梁`,
          nameEn: "Longitudinal beam",
          type: ComponentType.BEAM,
          layer: 3,
          step: 4,
          supportedBy: supports,
          connectedTo: supports,
          parentIds: supports,
        });
        zBeams[xi][zi] = id;
      }
    });
    return { x: xBeams, z: zBeams };
  }

  private buildDougong(
    grid: { columns: string[][] },
    beams: { x: string[][]; z: string[][] },
  ): string[][] {
    const xs = [-10, -6, -2, 2, 6, 10];
    const zs = [-5.5, -1.85, 1.85, 5.5];
    const ids: string[][] = [];
    zs.forEach((z, zi) => {
      ids[zi] = [];
      xs.forEach((x, xi) => {
        const id = `DG-Z${zi + 1}-X${xi + 1}`;
        const group = new THREE.Group();
        const block = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.4, 0.72), this.materials.gold);
        block.position.y = -0.22;
        const armX = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.25, 0.42), this.materials.teal);
        armX.position.y = 0.12;
        const armZ = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.25, 1.5), this.materials.redBright);
        armZ.position.y = 0.42;
        const cap = new THREE.Mesh(new THREE.BoxGeometry(1.28, 0.18, 0.56), this.materials.tealDark);
        cap.position.y = 0.67;
        group.add(block, armX, armZ, cap);
        group.position.set(x, 7.95, z);

        const adjacentBeams = [
          beams.x[zi]?.[Math.max(0, xi - 1)],
          beams.x[zi]?.[Math.min(xi, 4)],
          beams.z[xi]?.[Math.max(0, zi - 1)],
          beams.z[xi]?.[Math.min(zi, 2)],
        ].filter((value): value is string => Boolean(value));
        this.addComponent(group, {
          id,
          nameZh: `${this.gridName(xi, zi)}斗拱组`,
          nameEn: "Bracket-set assembly",
          type: ComponentType.DOUGONG,
          layer: 4,
          step: 5,
          parentIds: [grid.columns[zi][xi]],
          supportedBy: adjacentBeams,
          connectedTo: adjacentBeams,
        });
        ids[zi][xi] = id;
      });
    });
    return ids;
  }

  private buildPurlins(dougong: string[][]): string[] {
    const zs = [-5.8, -3.9, -1.95, 0, 1.95, 3.9, 5.8];
    return zs.map((z, index) => {
      const y = this.roofY(0, z) - 0.22;
      const purlin = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 21.8, 10), this.materials.wood);
      purlin.rotation.z = Math.PI / 2;
      purlin.position.set(0, y, z);
      const nearestRow = Math.min(3, Math.max(0, Math.round(((z + 5.5) / 11) * 3)));
      const supports = dougong[nearestRow].filter((_, columnIndex) => columnIndex % 2 === index % 2);
      const id = `PURLIN-${String(index + 1).padStart(2, "0")}`;
      this.addComponent(purlin, {
        id,
        nameZh: index === 3 ? "脊檩" : `${index < 3 ? "后坡" : "前坡"}檩条`,
        nameEn: index === 3 ? "Ridge purlin" : "Roof purlin",
        type: ComponentType.PURLIN,
        layer: 5,
        step: 6,
        parentIds: supports,
        supportedBy: supports,
        connectedTo: supports,
      });
      return id;
    });
  }

  private buildRafters(purlins: string[]): { front: string[]; back: string[] } {
    const front: string[] = [];
    const back: string[] = [];
    const angle = Math.atan2(4.45, 7.35);
    for (let i = 0; i < 19; i += 1) {
      const x = -10.8 + i * 1.2;
      const lift = this.cornerLift(x);
      (["front", "back"] as const).forEach((side) => {
        const sign = side === "front" ? 1 : -1;
        const rafter = new THREE.Mesh(this.geometries.rafter, this.materials.woodLight);
        rafter.rotation.x = sign * angle;
        rafter.position.set(x, 10.72 + lift, sign * 3.55);
        const id = `RAFTER-${side === "front" ? "F" : "B"}-${String(i + 1).padStart(2, "0")}`;
        this.addComponent(rafter, {
          id,
          nameZh: `${side === "front" ? "前坡" : "后坡"}椽子`,
          nameEn: `${side === "front" ? "Front" : "Rear"} slope rafter`,
          type: ComponentType.RAFTER,
          layer: 6,
          step: 7,
          supportedBy: purlins,
          connectedTo: purlins,
        });
        (side === "front" ? front : back).push(id);
      });
    }
    return { front, back };
  }

  private buildRoofPanels(rafters: { front: string[]; back: string[] }): { front: string[]; back: string[] } {
    const front: string[] = [];
    const back: string[] = [];
    const xSegments = 12;
    const zBands = 3;
    (["front", "back"] as const).forEach((side) => {
      const sign = side === "front" ? 1 : -1;
      for (let xi = 0; xi < xSegments; xi += 1) {
        const x0 = -11.6 + (23.2 / xSegments) * xi;
        const x1 = -11.6 + (23.2 / xSegments) * (xi + 1);
        for (let zi = 0; zi < zBands; zi += 1) {
          const inner = (7.4 / zBands) * zi;
          const outer = (7.4 / zBands) * (zi + 1);
          const z0 = sign * inner;
          const z1 = sign * outer;
          const points = [
            new THREE.Vector3(x0, this.roofY(x0, z0), z0),
            new THREE.Vector3(x1, this.roofY(x1, z0), z0),
            new THREE.Vector3(x1, this.roofY(x1, z1), z1),
            new THREE.Vector3(x0, this.roofY(x0, z1), z1),
          ];
          const center = points.reduce((acc, point) => acc.add(point), new THREE.Vector3()).multiplyScalar(0.25);
          const positions = new Float32Array(
            points.flatMap((point) => [point.x - center.x, point.y - center.y, point.z - center.z]),
          );
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
          geometry.setIndex(sign > 0 ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3]);
          geometry.computeVertexNormals();
          const mesh = new THREE.Mesh(geometry, (xi + zi) % 2 === 0 ? this.materials.roof : this.materials.roofAlt);
          mesh.position.copy(center);
          const id = `ROOF-${side === "front" ? "F" : "B"}-X${String(xi + 1).padStart(2, "0")}-B${zi + 1}`;
          const supportingRafter = (side === "front" ? rafters.front : rafters.back)[
            Math.min(18, Math.round((xi / (xSegments - 1)) * 18))
          ];
          this.addComponent(mesh, {
            id,
            nameZh: `${side === "front" ? "前坡" : "后坡"}瓦面板`,
            nameEn: `${side === "front" ? "Front" : "Rear"} tiled roof panel`,
            type: ComponentType.ROOF_PANEL,
            layer: 7,
            step: 8,
            parentIds: [supportingRafter],
            supportedBy: [supportingRafter],
            connectedTo: [supportingRafter],
          });
          (side === "front" ? front : back).push(id);
        }
      }
    });
    return { front, back };
  }

  private buildRidges(roofPanels: { front: string[]; back: string[] }): void {
    const main = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.34, 23.7, 8), this.materials.gold);
    main.rotation.z = Math.PI / 2;
    main.position.set(0, 13.48, 0);
    this.addComponent(main, {
      id: "RIDGE-MAIN-01",
      nameZh: "正脊",
      nameEn: "Main roof ridge",
      type: ComponentType.RIDGE,
      layer: 8,
      step: 9,
      supportedBy: [roofPanels.front[1], roofPanels.back[1]],
      connectedTo: [roofPanels.front[1], roofPanels.back[1]],
    });

    const corners = [
      [11.5, 7.3],
      [11.5, -7.3],
      [-11.5, 7.3],
      [-11.5, -7.3],
    ];
    corners.forEach(([x, z], index) => {
      const start = new THREE.Vector3(Math.sign(x) * 11.35, 13.35, 0);
      const end = new THREE.Vector3(x, this.roofY(x, z) + 0.16, z);
      const direction = end.clone().sub(start);
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.22, direction.length(), 8),
        this.materials.gold,
      );
      mesh.position.copy(start.clone().add(end).multiplyScalar(0.5));
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
      this.addComponent(mesh, {
        id: `RIDGE-HIP-${index + 1}`,
        nameZh: "简化垂脊",
        nameEn: "Hip ridge",
        type: ComponentType.RIDGE,
        layer: 8,
        step: 9,
        supportedBy: [index % 2 === 0 ? roofPanels.front[index * 3] : roofPanels.back[index * 3]],
      });
    });
  }

  private buildEnclosure(grid: { columns: string[][] }): void {
    const xs = [-10, -6, -2, 2, 6, 10];
    for (let bay = 0; bay < 5; bay += 1) {
      const x = (xs[bay] + xs[bay + 1]) / 2;
      const isDoor = bay >= 1 && bay <= 3;
      const panel = new THREE.Group();
      const frame = new THREE.Mesh(
        new THREE.BoxGeometry(3.15, 3.8, 0.16),
        isDoor ? this.materials.red : this.materials.enclosure,
      );
      panel.add(frame);
      for (let bar = -1; bar <= 1; bar += 1) {
        const vertical = new THREE.Mesh(new THREE.BoxGeometry(0.08, 3.55, 0.22), this.materials.dark);
        vertical.position.x = bar * 0.72;
        panel.add(vertical);
      }
      for (let bar = 0; bar < 3; bar += 1) {
        const horizontal = new THREE.Mesh(new THREE.BoxGeometry(2.95, 0.07, 0.22), this.materials.gold);
        horizontal.position.y = -1.15 + bar * 1.15;
        panel.add(horizontal);
      }
      panel.position.set(x, 3.48, 5.42);
      this.addComponent(panel, {
        id: `ENC-FRONT-${bay + 1}`,
        nameZh: isDoor ? "前檐槅扇门" : "前檐直棂窗",
        nameEn: isDoor ? "Lattice door" : "Lattice window",
        type: ComponentType.ENCLOSURE,
        layer: 3,
        step: 4,
        supportedBy: ["FND-003"],
        connectedTo: [grid.columns[3][bay], grid.columns[3][bay + 1]],
      });
    }

    for (let bay = 0; bay < 5; bay += 1) {
      const x = (xs[bay] + xs[bay + 1]) / 2;
      const wall = new THREE.Mesh(new THREE.BoxGeometry(3.3, 3.9, 0.23), this.materials.enclosure);
      wall.position.set(x, 3.48, -5.42);
      this.addComponent(wall, {
        id: `ENC-REAR-${bay + 1}`,
        nameZh: "后檐围护板",
        nameEn: "Rear enclosure panel",
        type: ComponentType.ENCLOSURE,
        layer: 3,
        step: 4,
        supportedBy: ["FND-003"],
        connectedTo: [grid.columns[0][bay], grid.columns[0][bay + 1]],
      });
    }
  }

  private finalizeConnections(): void {
    this.components.forEach(({ data }) => {
      data.supportedBy.forEach((supportId) => {
        const support = this.componentMap.get(supportId);
        if (support && !support.data.connectedTo.includes(data.componentId)) {
          support.data.connectedTo.push(data.componentId);
        }
      });
      data.connectedTo = [...new Set(data.connectedTo)];
      data.supportedBy = [...new Set(data.supportedBy)];
    });
  }

  private roofY(x: number, z: number): number {
    const halfDepth = 7.4;
    const ridge = 13.15;
    const slope = 4.5;
    const normalizedZ = Math.min(1, Math.abs(z) / halfDepth);
    return ridge - slope * normalizedZ + this.cornerLift(x) + 0.35 * normalizedZ ** 4;
  }

  private cornerLift(x: number): number {
    return 0.62 * Math.pow(Math.abs(x) / 11.6, 3.2);
  }

  private gridName(xIndex: number, zIndex: number): string {
    const rows = ["后檐", "后内", "前内", "前檐"];
    return `${rows[zIndex]}第${xIndex + 1}轴`;
  }
}
