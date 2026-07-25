import type * as THREE from "three";

export enum ComponentType {
  FOUNDATION = "FOUNDATION",
  COLUMN_BASE = "COLUMN_BASE",
  COLUMN = "COLUMN",
  BEAM = "BEAM",
  DOUGONG = "DOUGONG",
  PURLIN = "PURLIN",
  RAFTER = "RAFTER",
  ROOF_PANEL = "ROOF_PANEL",
  RIDGE = "RIDGE",
  ENCLOSURE = "ENCLOSURE",
}

export enum ComponentStatus {
  ACTIVE = "ACTIVE",
  MISSING = "MISSING",
  AFFECTED = "AFFECTED",
  REPAIRED = "REPAIRED",
}

export type QueryStatus = "PASS" | "UNKNOWN" | "INVALID" | "REPAIRED";

export interface TempleComponentData {
  componentId: string;
  componentNameZh: string;
  componentNameEn: string;
  componentType: ComponentType;
  layer: number;
  assemblyStep: number;
  originalPosition: THREE.Vector3;
  explodedPosition: THREE.Vector3;
  parentIds: string[];
  connectedTo: string[];
  supportedBy: string[];
  status: ComponentStatus;
  baseVisible: boolean;
}

export interface TempleComponent {
  object: THREE.Object3D;
  data: TempleComponentData;
}

export interface TempleModel {
  root: THREE.Group;
  components: TempleComponent[];
  componentMap: Map<string, TempleComponent>;
  scenarioAnchors: {
    missingDougongId: string;
    dougongAffectedRoofId: string;
    missingBeamId: string;
    beamAffectedRoofId: string;
  };
}

export const TYPE_LABELS: Record<ComponentType, { zh: string; en: string; color: string }> = {
  [ComponentType.FOUNDATION]: { zh: "石质台基", en: "Foundation", color: "#aeb9b3" },
  [ComponentType.COLUMN_BASE]: { zh: "柱础", en: "Column base", color: "#d5cdbd" },
  [ComponentType.COLUMN]: { zh: "木柱", en: "Column", color: "#a94439" },
  [ComponentType.BEAM]: { zh: "梁架", en: "Beam frame", color: "#ce6347" },
  [ComponentType.DOUGONG]: { zh: "斗拱", en: "Dougong", color: "#4da58e" },
  [ComponentType.PURLIN]: { zh: "檩条", en: "Purlin", color: "#866144" },
  [ComponentType.RAFTER]: { zh: "椽子", en: "Rafter", color: "#ba8a5c" },
  [ComponentType.ROOF_PANEL]: { zh: "屋面", en: "Roof panel", color: "#385f5d" },
  [ComponentType.RIDGE]: { zh: "屋脊", en: "Ridge", color: "#c8a04d" },
  [ComponentType.ENCLOSURE]: { zh: "门窗围护", en: "Enclosure", color: "#7e9b91" },
};

export const DISASSEMBLY_ORDER: ComponentType[][] = [
  [ComponentType.RIDGE, ComponentType.ROOF_PANEL],
  [ComponentType.RAFTER],
  [ComponentType.PURLIN],
  [ComponentType.DOUGONG],
  [ComponentType.BEAM, ComponentType.ENCLOSURE],
  [ComponentType.COLUMN],
  [ComponentType.COLUMN_BASE],
  [ComponentType.FOUNDATION],
];

export const STAGE_LABELS = [
  "屋脊与屋面",
  "椽子",
  "檩条",
  "斗拱",
  "梁架",
  "柱网",
  "柱础",
  "台基",
];

export function getComponentData(object: THREE.Object3D | null): TempleComponentData | null {
  let current = object;
  while (current) {
    if (current.userData.componentData) {
      return current.userData.componentData as TempleComponentData;
    }
    current = current.parent;
  }
  return null;
}

export function getComponentRoot(object: THREE.Object3D | null): THREE.Object3D | null {
  let current = object;
  while (current) {
    if (current.userData.componentData) return current;
    current = current.parent;
  }
  return null;
}
