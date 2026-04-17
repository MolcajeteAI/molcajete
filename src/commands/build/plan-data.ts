import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { parentTaskId } from "../../lib/utils.js";
import type { Phase, PlanData, Settings, SubTask, Task } from "../../types.js";

// ── Plan JSON I/O ──

export function readPlan(planPath: string): PlanData {
  return JSON.parse(readFileSync(planPath, "utf8"));
}

export function writePlan(planPath: string, data: PlanData): void {
  const tmp = `${planPath}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  renameSync(tmp, planPath);
}

export function updatePlanJson(planPath: string, mutator: (data: PlanData) => void): void {
  const data = readPlan(planPath);
  mutator(data);
  writePlan(planPath, data);
}

// ── Settings ──

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

export function readSettings(projectRoot: string): Settings {
  const settingsPath = join(projectRoot, ".molcajete", "settings.json");
  const defaults: Settings = {
    maxDevCycles: 7,
    remote: "origin",
    push: true,
    hookTimeout: 180000,
    maxParallel: 1,
    failureThreshold: 3,
  };

  let raw: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    try {
      raw = JSON.parse(readFileSync(settingsPath, "utf8"));
    } catch {
      raw = {};
    }
  }

  const envMaxParallel = process.env.MOLCAJETE_MAX_CONCURRENCY;
  const envFailureThreshold = process.env.MOLCAJETE_FAILURE_THRESHOLD;

  const maxParallelRaw =
    envMaxParallel !== undefined
      ? Number.parseInt(envMaxParallel, 10)
      : ((raw.maxParallel as number | undefined) ?? defaults.maxParallel);
  const failureThresholdRaw =
    envFailureThreshold !== undefined
      ? Number.parseInt(envFailureThreshold, 10)
      : ((raw.failureThreshold as number | undefined) ?? defaults.failureThreshold);

  return {
    maxDevCycles: (raw.maxDevCycles as number | undefined) ?? defaults.maxDevCycles,
    remote: (raw.remote as string | undefined) ?? defaults.remote,
    push: (raw.push as boolean | undefined) ?? defaults.push,
    hookTimeout: (raw.hookTimeout as number | undefined) ?? defaults.hookTimeout,
    maxParallel: clampInt(maxParallelRaw, 1, 16),
    failureThreshold: clampInt(failureThresholdRaw, 1, 100),
  };
}

// ── Task Lookup ──

export function findTask(data: PlanData, taskId: string): Task | undefined {
  return data.tasks.find((t) => t.id === taskId);
}

export function findSubTask(data: PlanData, subTaskId: string): SubTask | null {
  const pId = parentTaskId(subTaskId);
  const task = findTask(data, pId);
  if (!task?.sub_tasks) return null;
  return task.sub_tasks.find((st) => st.id === subTaskId) ?? null;
}

export function updateSubTaskStatus(
  planPath: string,
  subTaskId: string,
  status: SubTask["status"],
  extra: Record<string, unknown> = {},
): void {
  updatePlanJson(planPath, (data) => {
    const pId = parentTaskId(subTaskId);
    const task = findTask(data, pId);
    if (!task?.sub_tasks) return;
    const st = task.sub_tasks.find((s) => s.id === subTaskId);
    if (st) {
      st.status = status;
      Object.assign(st, extra);
    }
  });
}

// ── Stage tracking ──
//
// Stage marks the current phase of a task/sub-task within the build cycle
// (DEV, DOC, etc.) so a resumed build can skip ahead to the phase it left off.
// Stage writes only happen before committing phases (DEV, DOC) — writing before
// a non-committing phase (VERIFY, REVIEW) would leave the plan.json change
// orphaned in the worktree until the next commit and can cause issues.

export function updateTaskStage(planPath: string, taskId: string, stage: Phase | undefined): void {
  updatePlanJson(planPath, (data) => {
    const task = findTask(data, taskId);
    if (!task) return;
    if (stage === undefined) {
      delete task.stage;
    } else {
      task.stage = stage;
    }
  });
}

export function updateSubTaskStage(planPath: string, subTaskId: string, stage: Phase | undefined): void {
  updatePlanJson(planPath, (data) => {
    const pId = parentTaskId(subTaskId);
    const task = findTask(data, pId);
    if (!task?.sub_tasks) return;
    const st = task.sub_tasks.find((s) => s.id === subTaskId);
    if (!st) return;
    if (stage === undefined) {
      delete st.stage;
    } else {
      st.stage = stage;
    }
  });
}

// ── Dependency Checking ──

/**
 * Check if all dependencies for a task are satisfied.
 * @returns 0 = all deps done, 1 = a dep failed, 2 = a dep still pending/in_progress
 */
export function checkDependencies(data: PlanData, taskId: string): number {
  const task = findTask(data, taskId);
  if (!task) return 0;
  const deps = task.depends_on || [];

  for (const depId of deps) {
    const dep = findTask(data, depId);
    if (!dep) continue;
    if (dep.status === "implemented") continue;
    if (dep.status === "failed") return 1;
    return 2;
  }
  return 0;
}

/**
 * Check sub-task dependencies within a task.
 * @returns 0 = all deps done, 1 = a dep failed, 2 = a dep still pending/in_progress
 */
export function checkSubTaskDeps(task: Task, subTaskId: string): number {
  if (!task.sub_tasks) return 0;
  const st = task.sub_tasks.find((s) => s.id === subTaskId);
  if (!st) return 0;
  const deps = st.depends_on || [];

  for (const depId of deps) {
    const dep = task.sub_tasks.find((s) => s.id === depId);
    if (!dep) continue;
    if (dep.status === "implemented") continue;
    if (dep.status === "failed") return 1;
    return 2;
  }
  return 0;
}

// ── Plan-Level Status ──

export function updatePlanLevelStatus(
  planFile: string,
  taskCount: number,
  doneCount: number,
  failedCount: number,
): void {
  let newStatus: string;
  if (doneCount === taskCount) {
    newStatus = "implemented";
  } else if (failedCount > 0) {
    newStatus = "failed";
  } else {
    return;
  }

  updatePlanJson(planFile, (data) => {
    data.status = newStatus;
  });
}

// ── Plan File Resolution ──

/**
 * Resolve a plan name to a plan.json path.
 * Accepts: directory name, timestamp prefix, slug substring, absolute path, file:// URI, URL.
 */
export function resolvePlanFile(plansDir: string, name: string): string | null {
  // Absolute path
  if (isAbsolute(name)) {
    if (existsSync(name)) return name;
    const asJson = join(name, "plan.json");
    if (existsSync(asJson)) return asJson;
    return null;
  }

  // file:// URI
  if (name.startsWith("file://")) {
    const filePath = name.slice(7);
    if (existsSync(filePath)) return filePath;
    const asJson = join(filePath, "plan.json");
    if (existsSync(asJson)) return asJson;
    return null;
  }

  // URL (https://)
  if (name.startsWith("https://") || name.startsWith("http://")) {
    // URLs are not resolved locally — return null (caller handles fetch)
    return null;
  }

  // Relative path that exists
  const asRelative = resolve(name);
  if (existsSync(asRelative)) {
    if (asRelative.endsWith(".json")) return asRelative;
    const asJson = join(asRelative, "plan.json");
    if (existsSync(asJson)) return asJson;
  }

  // Directory-based resolution in plansDir
  const entries = readdirSync(plansDir, { withFileTypes: true });
  const dirs = entries
    .filter((e) => e.isDirectory() && existsSync(join(plansDir, e.name, "plan.json")))
    .map((e) => e.name);

  // Exact match
  if (dirs.includes(name)) return join(plansDir, name, "plan.json");

  // Strip .json suffix if user passed old-style name
  const stripped = name.replace(/\.json$/, "");
  if (dirs.includes(stripped)) return join(plansDir, stripped, "plan.json");

  // Prefix match (timestamp)
  const byPrefix = dirs.filter((d) => d.startsWith(stripped));
  if (byPrefix.length === 1) return join(plansDir, byPrefix[0], "plan.json");

  // Substring match (slug)
  const bySlug = dirs.filter((d) => d.includes(stripped));
  if (bySlug.length === 1) return join(plansDir, bySlug[0], "plan.json");

  if (byPrefix.length > 1 || bySlug.length > 1) {
    const matches = [...new Set([...byPrefix, ...bySlug])];
    process.stderr.write(`Error: ambiguous plan name "${name}". Matches:\n  ${matches.join("\n  ")}\n`);
    process.exit(1);
  }

  return null;
}

/**
 * Translate a plan path rooted at projectRoot to its equivalent inside a worktree.
 * Used when a worktree is active for a task — all plan/report writes during that
 * task target the worktree's copy so the merge back into the base branch is the
 * sole point of integration.
 */
export function worktreePlanFile(planFile: string, projectRoot: string, worktreePath: string): string {
  return join(worktreePath, relative(projectRoot, planFile));
}
