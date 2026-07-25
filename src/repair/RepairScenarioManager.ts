import * as THREE from "three";
import {
  ComponentStatus,
  ComponentType,
  type QueryStatus,
  type TempleComponent,
  type TempleModel,
} from "../temple/componentTypes";

export type ScenarioId = "dougong" | "beam";

export interface RepairState {
  scenarioId: ScenarioId | null;
  target: TempleComponent | null;
  affectedIds: string[];
  queryStatus: QueryStatus;
  description: string;
  repairing: boolean;
}

interface ScenarioDefinition {
  id: ScenarioId;
  targetId: string;
  affectedRoofId: string;
  unresolvedStatus: Extract<QueryStatus, "UNKNOWN" | "INVALID">;
  missingDescription: string;
  repairedDescription: string;
}

export class RepairScenarioManager {
  private current: ScenarioDefinition | null = null;
  private affectedIds: string[] = [];
  private candidate: THREE.Object3D | null = null;
  private animation: { elapsed: number; duration: number; start: THREE.Vector3; end: THREE.Vector3 } | null = null;
  private onState?: (state: RepairState) => void;

  private readonly scenarios: Record<ScenarioId, ScenarioDefinition>;

  constructor(private readonly model: TempleModel) {
    this.scenarios = {
      dougong: {
        id: "dougong",
        targetId: model.scenarioAnchors.missingDougongId,
        affectedRoofId: model.scenarioAnchors.dougongAffectedRoofId,
        unresolvedStatus: "UNKNOWN",
        missingDescription: "关键斗拱节点缺失，局部檩条至柱网的传力关系无法确认；青色半透明体为同编号候选构件。",
        repairedDescription: "候选斗拱已回装，原有父子关系与支撑边恢复，受影响屋面重新获得完整支撑路径。",
      },
      beam: {
        id: "beam",
        targetId: model.scenarioAnchors.missingBeamId,
        affectedRoofId: model.scenarioAnchors.beamAffectedRoofId,
        unresolvedStatus: "INVALID",
        missingDescription: "横梁节点缺失使上部斗拱失去有效承托，语义图谱检测到支撑路径中断。",
        repairedDescription: "横梁完成定位与装配，上部斗拱、檩条、椽子和屋面板的支撑链已重新连通。",
      },
    };
  }

  activate(id: ScenarioId): RepairState {
    this.resetAll(false);
    this.current = this.scenarios[id];
    const target = this.model.componentMap.get(this.current.targetId)!;
    target.data.status = ComponentStatus.MISSING;
    target.object.visible = false;
    this.affectedIds = this.findDependents(target.data.componentId);
    this.affectedIds.forEach((affectedId) => {
      const affected = this.model.componentMap.get(affectedId);
      if (affected && affected.data.status === ComponentStatus.ACTIVE) {
        affected.data.status = ComponentStatus.AFFECTED;
      }
    });
    this.createCandidate(target);
    return this.emit();
  }

  applyRepair(): boolean {
    if (!this.current || !this.candidate || this.animation) return false;
    const target = this.model.componentMap.get(this.current.targetId)!;
    this.animation = {
      elapsed: 0,
      duration: 1.45,
      start: this.candidate.position.clone(),
      end: target.data.originalPosition.clone(),
    };
    this.emit();
    return true;
  }

  update(delta: number): void {
    if (!this.animation || !this.candidate || !this.current) return;
    this.animation.elapsed += delta;
    const raw = Math.min(1, this.animation.elapsed / this.animation.duration);
    const eased = 1 - Math.pow(1 - raw, 4);
    this.candidate.position.lerpVectors(this.animation.start, this.animation.end, eased);
    this.candidate.rotation.y += delta * (1 - raw) * 1.8;
    if (raw >= 1) {
      const target = this.model.componentMap.get(this.current.targetId)!;
      this.model.root.remove(this.candidate);
      this.disposeCandidateMaterials(this.candidate);
      this.candidate = null;
      this.animation = null;
      target.object.position.copy(target.data.originalPosition);
      target.object.visible = target.data.baseVisible;
      target.data.status = ComponentStatus.REPAIRED;
      this.affectedIds.forEach((id) => {
        const affected = this.model.componentMap.get(id);
        if (affected && affected.data.status === ComponentStatus.AFFECTED) {
          affected.data.status = ComponentStatus.ACTIVE;
        }
      });
      this.emit();
    }
  }

  resetCurrent(): RepairState | null {
    if (!this.current) return null;
    const id = this.current.id;
    return this.activate(id);
  }

  resetAll(notify = true): void {
    if (this.candidate) {
      this.model.root.remove(this.candidate);
      this.disposeCandidateMaterials(this.candidate);
      this.candidate = null;
    }
    this.animation = null;
    this.model.components.forEach(({ object, data }) => {
      data.status = ComponentStatus.ACTIVE;
      object.visible = data.baseVisible;
    });
    this.current = null;
    this.affectedIds = [];
    if (notify) this.emit();
  }

  getState(): RepairState {
    return this.makeState();
  }

  setStateCallback(callback: (state: RepairState) => void): void {
    this.onState = callback;
  }

  private createCandidate(target: TempleComponent): void {
    const candidate = target.object.clone(true);
    candidate.userData = { repairCandidate: true };
    candidate.traverse((child) => {
      child.userData = { repairCandidate: true };
      if (child instanceof THREE.Mesh) {
        child.material = new THREE.MeshStandardMaterial({
          color: 0x4ee7db,
          emissive: 0x147d76,
          emissiveIntensity: 1.15,
          transparent: true,
          opacity: 0.62,
          depthWrite: false,
          roughness: 0.35,
          side: THREE.DoubleSide,
        });
        child.castShadow = false;
      }
    });
    candidate.position.copy(target.data.explodedPosition);
    this.model.root.add(candidate);
    this.candidate = candidate;
  }

  private findDependents(targetId: string): string[] {
    const dependents = new Set<string>();
    const queue = [targetId];
    while (queue.length) {
      const current = queue.shift()!;
      this.model.components.forEach(({ data }) => {
        if (data.supportedBy.includes(current) && !dependents.has(data.componentId)) {
          dependents.add(data.componentId);
          queue.push(data.componentId);
        }
      });
    }
    dependents.delete(targetId);
    return [...dependents];
  }

  private hasSupportPath(componentId: string, visited = new Set<string>()): boolean {
    if (visited.has(componentId)) return false;
    visited.add(componentId);
    const component = this.model.componentMap.get(componentId);
    if (!component || component.data.status === ComponentStatus.MISSING) return false;
    if (component.data.componentType === ComponentType.FOUNDATION) return true;
    if (component.data.supportedBy.length === 0) return false;
    return component.data.supportedBy.some((id) => this.hasSupportPath(id, new Set(visited)));
  }

  private makeState(): RepairState {
    if (!this.current) {
      return {
        scenarioId: null,
        target: null,
        affectedIds: [],
        queryStatus: "PASS",
        description: "当前结构语义图谱未激活缺陷案例。",
        repairing: false,
      };
    }
    const target = this.model.componentMap.get(this.current.targetId)!;
    const pathValid = this.hasSupportPath(this.current.affectedRoofId);
    const repaired = target.data.status === ComponentStatus.REPAIRED;
    return {
      scenarioId: this.current.id,
      target,
      affectedIds: this.affectedIds,
      queryStatus: repaired ? "REPAIRED" : pathValid ? "PASS" : this.current.unresolvedStatus,
      description: repaired ? this.current.repairedDescription : this.current.missingDescription,
      repairing: this.animation !== null,
    };
  }

  private emit(): RepairState {
    const state = this.makeState();
    this.onState?.(state);
    return state;
  }

  private disposeCandidateMaterials(candidate: THREE.Object3D): void {
    candidate.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose());
        else child.material.dispose();
      }
    });
  }
}
