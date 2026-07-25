import * as THREE from "three";
import type { TempleComponent } from "../temple/componentTypes";

export class ExplosionController {
  private readonly componentProgress = new Map<string, number>();
  private tween: { from: number; to: number; elapsed: number; duration: number } | null = null;
  private globalProgress = 0;
  private onProgress?: (progress: number) => void;

  constructor(private readonly components: TempleComponent[]) {
    components.forEach(({ data }) => this.componentProgress.set(data.componentId, 0));
  }

  setProgress(progress: number, notify = true): void {
    this.tween = null;
    this.globalProgress = THREE.MathUtils.clamp(progress, 0, 1);
    this.components.forEach(({ data }) => this.componentProgress.set(data.componentId, this.globalProgress));
    this.applyPositions();
    if (notify) this.onProgress?.(this.globalProgress);
  }

  setComponentProgress(componentIds: string[], progress: number): void {
    const value = THREE.MathUtils.clamp(progress, 0, 1);
    componentIds.forEach((id) => this.componentProgress.set(id, value));
    const total = [...this.componentProgress.values()].reduce((sum, item) => sum + item, 0);
    this.globalProgress = total / Math.max(1, this.componentProgress.size);
    this.applyPositions();
    this.onProgress?.(this.globalProgress);
  }

  animateTo(target: number, duration = 1.2): void {
    this.tween = {
      from: this.globalProgress,
      to: THREE.MathUtils.clamp(target, 0, 1),
      elapsed: 0,
      duration,
    };
  }

  update(delta: number): void {
    if (!this.tween) return;
    this.tween.elapsed += delta;
    const raw = Math.min(1, this.tween.elapsed / this.tween.duration);
    const eased = raw < 0.5 ? 4 * raw ** 3 : 1 - Math.pow(-2 * raw + 2, 3) / 2;
    const value = THREE.MathUtils.lerp(this.tween.from, this.tween.to, eased);
    this.globalProgress = value;
    this.components.forEach(({ data }) => this.componentProgress.set(data.componentId, value));
    this.applyPositions();
    this.onProgress?.(value);
    if (raw >= 1) this.tween = null;
  }

  getProgress(): number {
    return this.globalProgress;
  }

  isAnimating(): boolean {
    return this.tween !== null;
  }

  cancel(): void {
    this.tween = null;
  }

  setProgressCallback(callback: (progress: number) => void): void {
    this.onProgress = callback;
  }

  verifyNoDrift(epsilon = 1e-7): boolean {
    this.setProgress(0, false);
    return this.components.every(({ object, data }) => object.position.distanceTo(data.originalPosition) <= epsilon);
  }

  private applyPositions(): void {
    this.components.forEach(({ object, data }) => {
      const raw = this.componentProgress.get(data.componentId) ?? 0;
      const eased = raw * raw * (3 - 2 * raw);
      object.position.lerpVectors(data.originalPosition, data.explodedPosition, eased);
    });
  }
}
