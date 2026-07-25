import * as THREE from "three";
import {
  getComponentData,
  getComponentRoot,
  type TempleComponent,
  type TempleComponentData,
} from "../temple/componentTypes";

interface MaterialRecord {
  mesh: THREE.Mesh;
  material: THREE.Material | THREE.Material[];
}

export class SelectionManager {
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly materialRecords = new Map<THREE.Object3D, MaterialRecord[]>();
  private hovered: THREE.Object3D | null = null;
  private selected: THREE.Object3D | null = null;
  private pointerDown = { x: 0, y: 0 };
  private dragging = false;
  private onSelection?: (data: TempleComponentData | null) => void;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: THREE.Camera,
    private readonly roots: THREE.Object3D[],
    private readonly components: TempleComponent[],
  ) {
    canvas.addEventListener("pointerdown", this.handlePointerDown);
    canvas.addEventListener("pointermove", this.handlePointerMove);
    canvas.addEventListener("pointerup", this.handlePointerUp);
    canvas.addEventListener("pointerleave", this.handlePointerLeave);
  }

  setSelectionCallback(callback: (data: TempleComponentData | null) => void): void {
    this.onSelection = callback;
  }

  selectById(componentId: string): void {
    const component = this.components.find(({ data }) => data.componentId === componentId);
    if (component) this.select(component.object);
  }

  clear(): void {
    if (this.selected) {
      this.restoreMaterial(this.selected);
      this.selected = null;
    }
    this.onSelection?.(null);
  }

  getSelectedData(): TempleComponentData | null {
    return getComponentData(this.selected);
  }

  dispose(): void {
    this.canvas.removeEventListener("pointerdown", this.handlePointerDown);
    this.canvas.removeEventListener("pointermove", this.handlePointerMove);
    this.canvas.removeEventListener("pointerup", this.handlePointerUp);
    this.canvas.removeEventListener("pointerleave", this.handlePointerLeave);
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    this.pointerDown = { x: event.clientX, y: event.clientY };
    this.dragging = false;
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    const distance = Math.hypot(event.clientX - this.pointerDown.x, event.clientY - this.pointerDown.y);
    if (distance > 4 && event.buttons > 0) this.dragging = true;
    if (event.buttons > 0) return;

    const hit = this.pick(event);
    if (hit === this.hovered || hit === this.selected) return;
    if (this.hovered && this.hovered !== this.selected) this.restoreMaterial(this.hovered);
    this.hovered = hit;
    if (this.hovered && this.hovered !== this.selected) {
      this.applyMaterial(this.hovered, 0x78f5e7, 0.9);
      this.canvas.style.cursor = "pointer";
    } else {
      this.canvas.style.cursor = "grab";
    }
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (this.dragging) return;
    const hit = this.pick(event);
    if (hit) this.select(hit);
    else this.clear();
  };

  private readonly handlePointerLeave = (): void => {
    if (this.hovered && this.hovered !== this.selected) this.restoreMaterial(this.hovered);
    this.hovered = null;
    this.canvas.style.cursor = "grab";
  };

  private pick(event: PointerEvent): THREE.Object3D | null {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.roots, true);
    for (const hit of hits) {
      if (hit.object.userData.repairCandidate) continue;
      const root = getComponentRoot(hit.object);
      if (root && root.visible && this.isVisibleInHierarchy(root)) return root;
    }
    return null;
  }

  private select(object: THREE.Object3D): void {
    if (this.selected === object) {
      this.onSelection?.(getComponentData(object));
      return;
    }
    if (this.selected) this.restoreMaterial(this.selected);
    if (this.hovered === object) {
      this.restoreMaterial(object);
      this.hovered = null;
    }
    this.selected = object;
    this.applyMaterial(object, 0xffc857, 1.35);
    this.onSelection?.(getComponentData(object));
  }

  private applyMaterial(object: THREE.Object3D, color: number, intensity: number): void {
    if (this.materialRecords.has(object)) return;
    const records: MaterialRecord[] = [];
    object.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      records.push({ mesh: child, material: child.material });
      const original = Array.isArray(child.material) ? child.material[0] : child.material;
      const baseColor =
        original instanceof THREE.MeshStandardMaterial || original instanceof THREE.MeshPhongMaterial
          ? original.color.clone()
          : new THREE.Color(0x777777);
      const highlight = new THREE.MeshStandardMaterial({
        color: baseColor.lerp(new THREE.Color(color), 0.62),
        emissive: new THREE.Color(color),
        emissiveIntensity: intensity,
        roughness: 0.42,
        metalness: 0.08,
        transparent: original.transparent,
        opacity: original.opacity,
        side: original.side,
      });
      child.material = highlight;
    });
    this.materialRecords.set(object, records);
  }

  private restoreMaterial(object: THREE.Object3D): void {
    const records = this.materialRecords.get(object);
    if (!records) return;
    records.forEach(({ mesh, material }) => {
      const current = mesh.material;
      if (Array.isArray(current)) current.forEach((item) => item.dispose());
      else current.dispose();
      mesh.material = material;
    });
    this.materialRecords.delete(object);
  }

  private isVisibleInHierarchy(object: THREE.Object3D): boolean {
    let current: THREE.Object3D | null = object;
    while (current) {
      if (!current.visible) return false;
      current = current.parent;
    }
    return true;
  }
}
