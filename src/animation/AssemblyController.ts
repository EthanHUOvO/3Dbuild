import {
  DISASSEMBLY_ORDER,
  STAGE_LABELS,
  type TempleComponent,
} from "../temple/componentTypes";
import type { ExplosionController } from "./ExplosionController";

export type AssemblyMode = "idle" | "disassembling" | "assembling" | "paused";

export interface AssemblyState {
  mode: AssemblyMode;
  stage: number;
  stageLabel: string;
  overall: number;
}

export class AssemblyController {
  private mode: AssemblyMode = "idle";
  private previousMode: Exclude<AssemblyMode, "paused"> = "idle";
  private stageIndex = 0;
  private stageElapsed = 0;
  private readonly stageDuration = 0.72;
  private onState?: (state: AssemblyState) => void;
  private readonly idsByStage: string[][];
  private readonly stageLabels: string[];

  constructor(
    components: TempleComponent[],
    private readonly explosion: ExplosionController,
    order = DISASSEMBLY_ORDER,
    stageLabels = STAGE_LABELS,
  ) {
    this.idsByStage = order.map((types) =>
      components
        .filter(({ data }) => types.includes(data.componentType))
        .map(({ data }) => data.componentId),
    );
    this.stageLabels = stageLabels;
  }

  startDisassembly(): void {
    this.explosion.cancel();
    this.explosion.setProgress(0);
    this.mode = "disassembling";
    this.previousMode = "disassembling";
    this.stageIndex = 0;
    this.stageElapsed = 0;
    this.emit();
  }

  startAssembly(): void {
    this.explosion.cancel();
    this.explosion.setProgress(1);
    this.mode = "assembling";
    this.previousMode = "assembling";
    this.stageIndex = this.idsByStage.length - 1;
    this.stageElapsed = 0;
    this.emit();
  }

  update(delta: number): void {
    if (this.mode !== "disassembling" && this.mode !== "assembling") return;
    let remaining = delta;
    while (remaining > 0 && (this.mode === "disassembling" || this.mode === "assembling")) {
      const advance = Math.min(remaining, this.stageDuration - this.stageElapsed);
      this.stageElapsed += advance;
      remaining -= advance;
      const raw = Math.min(1, this.stageElapsed / this.stageDuration);
      const eased = raw * raw * (3 - 2 * raw);

      if (this.mode === "disassembling") {
        this.explosion.setComponentProgress(this.idsByStage[this.stageIndex], eased);
      } else {
        this.explosion.setComponentProgress(this.idsByStage[this.stageIndex], 1 - eased);
      }

      if (raw >= 1) {
        this.stageElapsed = 0;
        if (this.mode === "disassembling") {
          this.stageIndex += 1;
          if (this.stageIndex >= this.idsByStage.length) {
            this.stageIndex = this.idsByStage.length - 1;
            this.mode = "idle";
          }
        } else {
          this.stageIndex -= 1;
          if (this.stageIndex < 0) {
            this.stageIndex = 0;
            this.mode = "idle";
          }
        }
      }
    }
    this.emit();
  }

  togglePause(): AssemblyMode {
    if (this.mode === "paused") {
      this.mode = this.previousMode;
    } else if (this.mode === "assembling" || this.mode === "disassembling") {
      this.previousMode = this.mode;
      this.mode = "paused";
    }
    this.emit();
    return this.mode;
  }

  stop(): void {
    this.mode = "idle";
    this.previousMode = "idle";
    this.stageElapsed = 0;
    this.emit();
  }

  getMode(): AssemblyMode {
    return this.mode;
  }

  setStateCallback(callback: (state: AssemblyState) => void): void {
    this.onState = callback;
  }

  private emit(): void {
    const stageProgress = this.stageElapsed / this.stageDuration;
    const overall =
      this.mode === "idle"
        ? this.explosion.getProgress()
        : this.mode === "assembling"
          ? (this.stageIndex + 1 - stageProgress) / this.idsByStage.length
          : (this.stageIndex + stageProgress) / this.idsByStage.length;
    this.onState?.({
      mode: this.mode,
      stage: this.stageIndex,
      stageLabel: this.stageLabels[this.stageIndex] ?? "完成",
      overall: Math.max(0, Math.min(1, overall)),
    });
  }
}
