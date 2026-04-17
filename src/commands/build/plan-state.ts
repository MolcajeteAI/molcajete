import type { Phase, PlanData, Task } from "../../types.js";

/**
 * In-memory mirror of plan.json owned by the scheduler. The projectRoot plan
 * file is frozen during a parallel build — all state mutations go through
 * this class, and each worker commits only to its own worktree's plan.json.
 *
 * Scheduler state transitions (readyTaskIds, markInProgress, etc.) read and
 * write this object; the final on-disk plan.json is rewritten at build end.
 */
export class PlanState {
  private data: PlanData;
  private allowedTaskIds: Set<string> | null;

  constructor(data: PlanData, allowedTaskIds?: Set<string>) {
    this.data = deepClone(data);
    this.allowedTaskIds = allowedTaskIds ?? null;
  }

  snapshot(): PlanData {
    return deepClone(this.data);
  }

  /** Mutate the backing object under a callback — used for rare bulk writes. */
  mutate(fn: (data: PlanData) => void): void {
    fn(this.data);
  }

  findTask(taskId: string): Task | undefined {
    return this.data.tasks.find((t) => t.id === taskId);
  }

  /**
   * Task ids that are pending with every dependency implemented. Tasks marked
   * in_progress are intentionally excluded — callers can add resumeTaskIds
   * manually.
   */
  readyTaskIds(): string[] {
    const byId = new Map(this.data.tasks.map((t) => [t.id, t] as const));
    const out: string[] = [];
    for (const task of this.data.tasks) {
      if (task.status !== "pending") continue;
      const deps = task.depends_on ?? [];
      let ready = true;
      for (const depId of deps) {
        const dep = byId.get(depId);
        if (!dep) continue;
        if (dep.status !== "implemented") {
          ready = false;
          break;
        }
      }
      if (ready) out.push(task.id);
    }
    return this.allowedTaskIds ? out.filter((id) => this.allowedTaskIds!.has(id)) : out;
  }

  /** Tasks still waiting to be implemented (pending or in_progress). */
  unimplementedTaskIds(): string[] {
    return this.data.tasks
      .filter((t) => t.status !== "implemented")
      .filter((t) => !this.allowedTaskIds || this.allowedTaskIds.has(t.id))
      .map((t) => t.id);
  }

  /** Returns true if any dependency of taskId is marked failed. */
  hasFailedDependency(taskId: string): boolean {
    const task = this.findTask(taskId);
    if (!task) return false;
    for (const depId of task.depends_on ?? []) {
      const dep = this.findTask(depId);
      if (dep?.status === "failed") return true;
    }
    return false;
  }

  markInProgress(taskId: string): void {
    const task = this.findTask(taskId);
    if (!task) return;
    task.status = "in_progress";
    task.errors = [];
  }

  /**
   * Fold the worker's final plan state (read from its worktree's plan.json)
   * into the in-memory state. Only the task's own fields are copied — other
   * tasks remain as the scheduler saw them.
   */
  mergeWorkerResult(taskId: string, worktreeFinalState: PlanData): void {
    const worker = worktreeFinalState.tasks.find((t) => t.id === taskId);
    if (!worker) return;
    const idx = this.data.tasks.findIndex((t) => t.id === taskId);
    if (idx < 0) return;
    this.data.tasks[idx] = deepClone(worker);
  }

  markFailed(taskId: string, errors: string[], stage?: Phase): void {
    const task = this.findTask(taskId);
    if (!task) return;
    task.status = "failed";
    task.errors = errors;
    if (stage) task.stage = stage;
  }

  markMergeFailed(taskId: string, error: string): void {
    this.markFailed(taskId, [error], "DOC");
  }

  resetForRecovery(taskId: string): void {
    const task = this.findTask(taskId);
    if (!task) return;
    task.status = "pending";
    task.errors = [];
    delete task.stage;
    if (task.sub_tasks) {
      for (const st of task.sub_tasks) {
        if (st.status === "failed") {
          st.status = "pending";
          st.errors = [];
          delete st.stage;
        }
      }
    }
  }

  setPlanStatus(status: string): void {
    this.data.status = status;
  }
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
