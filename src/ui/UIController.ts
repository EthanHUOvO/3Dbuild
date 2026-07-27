import {
  ComponentStatus,
  ComponentType,
  STAGE_LABELS,
  TYPE_LABELS,
  type QueryStatus,
  type TempleComponent,
  type TempleComponentData,
} from "../temple/componentTypes";
import type { AssemblyState } from "../animation/AssemblyController";
import type { RepairState, ScenarioId } from "../repair/RepairScenarioManager";

export interface UIActions {
  onExplosionChange(value: number): void;
  onCompleteState(): void;
  onFullExplode(): void;
  onAutoDisassemble(): void;
  onAutoAssemble(): void;
  onPauseResume(): void;
  onResetCamera(): void;
  onResetModel(): void;
  onToggleGrid(): void;
  onTypeVisibility(type: ComponentType, visible: boolean): void;
  onShowAll(): void;
  onIsolateLayer(layer: number): void;
  onModeChange(mode: "structure" | "repair"): void;
  onScenarioChange(id: ScenarioId): void;
  onApplyRepair(): void;
  onResetScenario(): void;
}

export class UIController {
  private selectedData: TempleComponentData | null = null;
  private readonly typeVisibility = new Map<ComponentType, boolean>();
  private toastTimer = 0;

  constructor(
    private readonly components: TempleComponent[],
    private readonly actions: UIActions,
  ) {
    Object.values(ComponentType).forEach((type) => this.typeVisibility.set(type, true));
    this.renderFilters();
    this.renderStages();
    this.bindControls();
    this.updateCounts();
    this.setExplosionProgress(0);
  }

  setExplosionProgress(value: number): void {
    const percent = Math.round(value * 100);
    this.el<HTMLInputElement>("explosion-slider").value = String(percent);
    this.el("explosion-value").textContent = `${percent}%`;
    this.el("view-mode-label").textContent =
      percent === 0 ? "完整结构 · AXONOMETRIC" : percent === 100 ? "分层爆炸 · EXPLODED" : `拆解分析 · ${percent}%`;
  }

  updateSelection(data: TempleComponentData | null): void {
    this.selectedData = data;
    const empty = this.el("empty-selection");
    const details = this.el("component-details");
    const isolateButton = this.el<HTMLButtonElement>("isolate-layer");
    this.el("selection-count").textContent = `${data ? 1 : 0} SELECTED`;
    isolateButton.disabled = !data;

    if (!data) {
      empty.classList.remove("hidden");
      details.classList.add("hidden");
      return;
    }

    empty.classList.add("hidden");
    details.classList.remove("hidden");
    this.el("component-type-tag").textContent = data.componentType;
    this.el("component-name").textContent = `${data.componentNameZh} / ${data.componentNameEn}`;
    this.el("component-id").textContent = data.componentId;
    this.el("component-layer").textContent = `L${String(data.layer).padStart(2, "0")}`;
    this.el("component-step").textContent = `STEP ${String(data.assemblyStep).padStart(2, "0")}`;
    this.el("component-position").textContent =
      `${data.originalPosition.x.toFixed(1)}, ${data.originalPosition.y.toFixed(1)}, ${data.originalPosition.z.toFixed(1)}`;
    this.el("supported-by").textContent = this.formatRelations(data.supportedBy);
    this.el("connected-to").textContent = this.formatRelations(data.connectedTo);
    const status = this.el("component-status");
    status.textContent = data.status;
    status.className = `status-pill ${this.statusClass(data.status)}`;
  }

  updateAssembly(state: AssemblyState): void {
    const labels: Record<AssemblyState["mode"], string> = {
      idle: state.overall >= 0.99 ? "拆解完成" : state.overall <= 0.01 ? "装配完成" : "动画就绪",
      disassembling: `自动拆解 · ${state.stageLabel}`,
      assembling: `自动装配 · ${state.stageLabel}`,
      paused: `已暂停 · ${state.stageLabel}`,
    };
    this.el("assembly-state").textContent = labels[state.mode];
    const displayStep =
      state.mode === "idle"
        ? state.overall >= 0.99
          ? STAGE_LABELS.length
          : state.overall <= 0.01
            ? 0
            : state.stage + 1
        : state.stage + 1;
    this.el("assembly-step").textContent =
      `STEP ${String(displayStep).padStart(2, "0")} / ${String(STAGE_LABELS.length).padStart(2, "0")}`;
    this.el("pause-resume").textContent = state.mode === "paused" ? "▶" : "Ⅱ";
    this.el("pause-resume").classList.toggle("is-paused", state.mode === "paused");
    document.querySelectorAll<HTMLElement>(".stage-node").forEach((node, index) => {
      node.classList.toggle("active", index === state.stage && state.mode !== "idle");
      node.classList.toggle(
        "complete",
        state.mode === "disassembling"
          ? index < state.stage
          : state.mode === "assembling"
            ? index > state.stage
            : false,
      );
    });
  }

  updateRepair(state: RepairState): void {
    const status = this.el("query-status");
    status.textContent = state.queryStatus;
    const result = status.closest(".query-result");
    if (result) result.className = `query-result ${state.queryStatus.toLowerCase()}`;
    this.el("missing-node").textContent = state.target?.data.componentId ?? "—";
    this.el("affected-count").textContent = String(state.affectedIds.length);
    this.el("repair-description").textContent = state.description;
    const apply = this.el<HTMLButtonElement>("apply-repair");
    apply.disabled = !state.target || state.queryStatus === "REPAIRED" || state.repairing;
    apply.textContent = state.repairing
      ? "正在装配候选构件…"
      : state.queryStatus === "REPAIRED"
        ? "修复已完成"
        : "应用候选修复";
    if (state.target && this.selectedData?.componentId === state.target.data.componentId) {
      this.updateSelection(state.target.data);
    }
  }

  setMode(mode: "structure" | "repair"): void {
    document.querySelectorAll<HTMLButtonElement>(".mode-btn").forEach((button) => {
      button.classList.toggle("active", button.dataset.mode === mode);
    });
    this.el("repair-panel").classList.toggle("hidden", mode !== "repair");
    document.body.classList.toggle("repair-mode", mode === "repair");
  }

  setScenario(id: ScenarioId): void {
    document.querySelectorAll<HTMLButtonElement>(".scenario-btn").forEach((button) => {
      button.classList.toggle("active", button.dataset.scenario === id);
    });
  }

  setLoading(visible: boolean): void {
    this.el("loading").classList.toggle("is-hidden", !visible);
  }

  showToast(message: string, kind: "info" | "success" | "warning" = "info"): void {
    const toast = this.el("toast");
    window.clearTimeout(this.toastTimer);
    toast.textContent = message;
    toast.className = `toast visible ${kind}`;
    this.toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 2800);
  }

  updateCounts(): void {
    const visible = this.components.filter(({ object, data }) => object.visible && data.baseVisible).length;
    this.el("visible-count").textContent = String(visible);
    this.el("total-count").textContent = String(this.components.length);
    document.querySelectorAll<HTMLElement>("[data-type-count]").forEach((element) => {
      const type = element.dataset.typeCount as ComponentType;
      element.textContent = String(this.components.filter(({ data }) => data.componentType === type).length);
    });
  }

  syncAllTypeVisibility(visible: boolean): void {
    Object.values(ComponentType).forEach((type) => this.typeVisibility.set(type, visible));
    document.querySelectorAll<HTMLInputElement>(".type-toggle").forEach((input) => {
      input.checked = visible;
    });
    this.el("toggle-all").textContent = visible ? "全部隐藏" : "全部显示";
    this.updateCounts();
  }

  private renderFilters(): void {
    const container = this.el("type-filters");
    container.innerHTML = Object.values(ComponentType)
      .map((type) => {
        const label = TYPE_LABELS[type];
        const count = this.components.filter(({ data }) => data.componentType === type).length;
        if (count === 0) return "";
        return `
          <label class="type-row">
            <input class="type-toggle" type="checkbox" data-type="${type}" checked />
            <span class="toggle-box"><i></i></span>
            <span class="type-color" style="--type-color:${label.color}"></span>
            <span class="type-name"><strong>${label.zh}</strong><small>${label.en}</small></span>
            <em data-type-count="${type}">${count}</em>
          </label>
        `;
      })
      .join("");
  }

  private renderStages(): void {
    this.el("stage-track").innerHTML = STAGE_LABELS.map(
      (label, index) => `
        <div class="stage-node" title="${label}">
          <i></i><span>${String(index + 1).padStart(2, "0")}</span>
        </div>
      `,
    ).join("");
  }

  private bindControls(): void {
    this.el<HTMLInputElement>("explosion-slider").addEventListener("input", (event) => {
      const value = Number((event.target as HTMLInputElement).value) / 100;
      this.actions.onExplosionChange(value);
    });
    this.el("complete-state").addEventListener("click", this.actions.onCompleteState);
    this.el("full-explode").addEventListener("click", this.actions.onFullExplode);
    this.el("auto-disassemble").addEventListener("click", this.actions.onAutoDisassemble);
    this.el("auto-assemble").addEventListener("click", this.actions.onAutoAssemble);
    this.el("pause-resume").addEventListener("click", this.actions.onPauseResume);
    this.el("reset-camera").addEventListener("click", this.actions.onResetCamera);
    this.el("reset-model").addEventListener("click", this.actions.onResetModel);
    this.el("toggle-grid").addEventListener("click", this.actions.onToggleGrid);
    this.el("show-all").addEventListener("click", () => {
      this.syncAllTypeVisibility(true);
      this.actions.onShowAll();
    });
    this.el("isolate-layer").addEventListener("click", () => {
      if (this.selectedData) this.actions.onIsolateLayer(this.selectedData.layer);
    });
    this.el("toggle-all").addEventListener("click", () => {
      const shouldShow = [...this.typeVisibility.values()].some((visible) => !visible);
      Object.values(ComponentType).forEach((type) => {
        this.typeVisibility.set(type, shouldShow);
        this.actions.onTypeVisibility(type, shouldShow);
      });
      this.syncAllTypeVisibility(shouldShow);
    });

    document.querySelectorAll<HTMLInputElement>(".type-toggle").forEach((input) => {
      input.addEventListener("change", () => {
        const type = input.dataset.type as ComponentType;
        this.typeVisibility.set(type, input.checked);
        this.actions.onTypeVisibility(type, input.checked);
        this.el("toggle-all").textContent = [...this.typeVisibility.values()].every(Boolean)
          ? "全部隐藏"
          : "全部显示";
        this.updateCounts();
      });
    });

    document.querySelectorAll<HTMLButtonElement>(".mode-btn").forEach((button) => {
      button.addEventListener("click", () => {
        const mode = button.dataset.mode as "structure" | "repair";
        this.setMode(mode);
        this.actions.onModeChange(mode);
      });
    });
    document.querySelectorAll<HTMLButtonElement>(".scenario-btn").forEach((button) => {
      button.addEventListener("click", () => {
        const id = button.dataset.scenario as ScenarioId;
        this.setScenario(id);
        this.actions.onScenarioChange(id);
      });
    });
    this.el("apply-repair").addEventListener("click", this.actions.onApplyRepair);
    this.el("reset-scenario").addEventListener("click", this.actions.onResetScenario);

    const help = this.el("help-popover");
    this.el("help-button").addEventListener("click", () => help.classList.toggle("hidden"));
    this.el("close-help").addEventListener("click", () => help.classList.add("hidden"));
  }

  private formatRelations(ids: string[]): string {
    if (!ids.length) return "ROOT / 无上游关系";
    const preview = ids.slice(0, 3).join(" · ");
    return ids.length > 3 ? `${preview} · +${ids.length - 3}` : preview;
  }

  private statusClass(status: ComponentStatus | QueryStatus): string {
    if (status === ComponentStatus.MISSING || status === "INVALID") return "invalid";
    if (status === ComponentStatus.AFFECTED || status === "UNKNOWN") return "unknown";
    if (status === ComponentStatus.REPAIRED) return "repaired";
    return "pass";
  }

  private el<T extends HTMLElement = HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Missing UI element: #${id}`);
    return element as T;
  }
}
