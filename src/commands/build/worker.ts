import { dirname } from "node:path";
import type { AsyncMutex } from "../../lib/async-mutex.js";
import { MAX_DEV_CYCLES } from "../../lib/config.js";
import { taskHeading } from "../../lib/format.js";
import { commitPlanFile, planRelativePath, rebaseOnRemoteBase } from "../../lib/git.js";
import { taskContext } from "../../lib/log-context.js";
import { log, logDetail } from "../../lib/utils.js";
import type { HookMap, PlanData, RecoveryContext, Settings, WorktreeInfo } from "../../types.js";
import { tryHook } from "../lib/hooks.js";
import { buildBuildContext } from "./cycle.js";
import { findTask, readPlan, updatePlanJson, updateTaskStage, worktreePlanFile, writePlan } from "./plan-data.js";
import {
  commitDocChanges,
  maybePushAfterCommit,
  runDocSession,
  runRecoverySession,
} from "./sessions.js";
import { runSimpleTask, runTaskWithSubTasks } from "./tasks.js";
import { type ActiveWorktree, registerWorktree, unregisterWorktree } from "./worktree-registry.js";
import { mergeWorktree, setupWorktree } from "./worktree.js";

export type WorkerOutcome = "ok" | "dev_failed" | "merge_failed" | "infra_failed";

export interface WorkerResult {
  taskId: string;
  outcome: WorkerOutcome;
  error?: string;
  worktree?: WorktreeInfo;
  /** The task's final plan.json state, read from the worktree after the task finishes. */
  worktreeFinalState?: PlanData;
  /** Optional summary written by the dev session — surfaces to the orchestrator. */
  summary?: string;
}

export interface WorkerInputs {
  hooks: HookMap;
  projectRoot: string;
  planFile: string;
  planName: string;
  settings: Settings;
  taskId: string;
  resume: boolean;
  noWorktrees: boolean;
  gitMutex?: AsyncMutex;
  /**
   * The orchestrator's current in-memory plan state. Seeded into the worktree's
   * plan.json at worker start so remote runners (e.g. ECR Fargate) that pull
   * the task branch can see the orchestrator's view of the world.
   */
  planStateSnapshot: PlanData;
  /**
   * Collected summaries of every implemented task as of the scheduler's tick.
   * Threaded through the dev/test/review cycle as context for the model.
   */
  priorSummaries: string[];
}

/**
 * Run a single task end-to-end: setup worktree, seed plan.json, dev/test/review,
 * doc session, merge to remote base.
 */
export async function runTaskWorker(inputs: WorkerInputs): Promise<WorkerResult> {
  return taskContext.run({ taskId: inputs.taskId }, () => runTaskWorkerInner(inputs));
}

async function runTaskWorkerInner(inputs: WorkerInputs): Promise<WorkerResult> {
  const {
    hooks,
    projectRoot,
    planName,
    planFile,
    settings,
    taskId,
    resume,
    noWorktrees,
    gitMutex,
    planStateSnapshot,
  } = inputs;

  const task = planStateSnapshot.tasks.find((t) => t.id === taskId);
  if (!task) {
    return { taskId, outcome: "infra_failed", error: `task ${taskId} not found in plan` };
  }

  {
    const h = taskHeading(taskId, task.title);
    log(h.title);
    logDetail(h.rule);
  }

  const baseBranch = planStateSnapshot.base_branch || "main";
  const useWorktrees = !noWorktrees;

  let worktree: WorktreeInfo | null = null;
  let registered: ActiveWorktree | null = null;
  if (useWorktrees) {
    worktree = await setupWorktree(
      hooks,
      projectRoot,
      planName,
      taskId,
      baseBranch,
      planFile,
      settings,
      resume,
      gitMutex,
    );
    if (!worktree) {
      return { taskId, outcome: "infra_failed", error: "Failed to create worktree" };
    }
    registered = {
      taskId,
      worktreePath: worktree.worktreePath,
      branchName: worktree.branchName,
      remote: settings.remote,
    };
    registerWorktree(registered);
  }

  try {
    return await runTaskWorkerBody({
      inputs,
      task,
      worktree,
      baseBranch,
    });
  } finally {
    if (registered) unregisterWorktree(registered);
  }
}

interface TaskBodyInputs {
  inputs: WorkerInputs;
  task: PlanData["tasks"][number];
  worktree: WorktreeInfo | null;
  baseBranch: string;
}

async function runTaskWorkerBody({
  inputs,
  task,
  worktree,
  baseBranch,
}: TaskBodyInputs): Promise<WorkerResult> {
  const {
    hooks,
    projectRoot,
    planFile,
    planName,
    settings,
    taskId,
    resume,
    gitMutex,
    planStateSnapshot,
    priorSummaries,
  } = inputs;

  const taskCwd = worktree?.worktreePath;
  const taskBranch = worktree?.branchName;
  const taskPlanFile = worktree ? worktreePlanFile(planFile, projectRoot, worktree.worktreePath) : planFile;
  const taskPlanDir = worktree ? dirname(taskPlanFile) : dirname(planFile);
  const taskWriteCwd = worktree ? worktree.worktreePath : projectRoot;

  // Seed the worktree's plan.json with the orchestrator's view. Skipped on
  // resume — the task branch already carries the last committed state.
  if (worktree && !resume) {
    try {
      writePlan(taskPlanFile, planStateSnapshot);
    } catch (err) {
      return {
        taskId,
        outcome: "infra_failed",
        error: `failed to seed plan.json: ${(err as Error).message}`,
        worktree: worktree ?? undefined,
      };
    }

    // Mark this task in_progress in the seeded plan so the committed branch
    // tip reflects the correct state for any remote runner / resume.
    updatePlanJson(taskPlanFile, (d) => {
      const t = findTask(d, taskId);
      if (t) {
        t.status = "in_progress";
        t.errors = [];
      }
    });

    const seedCommit = commitPlanFile(
      taskWriteCwd,
      taskPlanFile,
      "chore(plan): seed task branch with current orchestrator state",
    );
    if (!seedCommit.ok && !seedCommit.skipped) {
      log(`Warning: seed commit failed for ${taskId}: ${seedCommit.error}`);
    } else if (!seedCommit.skipped) {
      await maybePushAfterCommit(settings, `seed ${taskId}`, taskCwd);
    }
  }

  // Stage-boundary resume: if the task's stage is DOC, skip dev-test-review.
  const freshTaskOnDisk = findTask(readPlan(taskPlanFile), taskId);
  const resumeAtDoc = resume && freshTaskOnDisk?.stage === "DOC";
  if (resumeAtDoc) {
    log(`Task ${taskId}: resuming at DOC stage — skipping dev-test-review`);
  }

  let cycleResult: { ok: boolean; error?: string; devResult?: unknown };
  if (resumeAtDoc) {
    cycleResult = { ok: true };
  } else if (task.sub_tasks && task.sub_tasks.length > 0) {
    cycleResult = await runTaskWithSubTasks(
      hooks,
      projectRoot,
      taskPlanFile,
      task,
      priorSummaries,
      taskPlanDir,
      settings,
      planName,
      baseBranch,
      taskCwd,
      taskBranch,
    );
  } else {
    cycleResult = await runSimpleTask(
      hooks,
      projectRoot,
      taskPlanFile,
      task,
      priorSummaries,
      taskPlanDir,
      settings,
      planName,
      baseBranch,
      taskCwd,
      taskBranch,
    );
  }

  if (!cycleResult.ok) {
    // Preserve the worktree for debugging / recovery.
    if (worktree) {
      log(`Task ${taskId}: failed — worktree preserved at ${worktree.worktreePath}`);
    }
    const worktreeFinalState = safeReadPlan(taskPlanFile);
    return {
      taskId,
      outcome: "dev_failed",
      error: cycleResult.error ?? "Task failed",
      worktree: worktree ?? undefined,
      worktreeFinalState,
    };
  }

  // Success: run doc session + merge.
  const devSummary =
    (cycleResult.devResult as { summary?: string } | undefined)?.summary ??
    extractAggregateSummary(taskPlanFile, taskId);

  await tryHook(
    hooks,
    "before-documentation",
    {
      task_id: taskId,
      ...(taskCwd && { cwd: taskCwd }),
      ...(taskBranch && { branch: taskBranch }),
      build: buildBuildContext(planFile, planName, "documentation"),
    },
    { timeout: settings.hookTimeout },
  );

  updateTaskStage(taskPlanFile, taskId, "DOC");

  if (taskCwd) {
    const rebased = await rebaseOnRemoteBase(taskCwd, settings.remote, baseBranch, `pre-doc-${taskId}`);
    if (!rebased.ok) {
      log(`Task ${taskId}: pre-doc rebase failed — worktree preserved at ${taskCwd}`);
      return {
        taskId,
        outcome: "merge_failed",
        error: `Pre-doc rebase failed: ${rebased.error}`,
        worktree: worktree ?? undefined,
        worktreeFinalState: safeReadPlan(taskPlanFile),
      };
    }
  }

  const doc = await runDocSession(
    projectRoot,
    taskPlanFile,
    task,
    [...priorSummaries, devSummary].join("\n"),
    [],
    planName,
    taskCwd,
  );
  if (doc.ok && doc.structured?.files_modified?.length > 0) {
    await commitDocChanges(task.id, doc.structured.files_modified, taskCwd);
    await maybePushAfterCommit(settings, `doc ${taskId}`, taskCwd);
  }

  await tryHook(
    hooks,
    "after-documentation",
    {
      task_id: taskId,
      ...(taskCwd && { cwd: taskCwd }),
      ...(taskBranch && { branch: taskBranch }),
      build: buildBuildContext(planFile, planName, "documentation"),
    },
    { timeout: settings.hookTimeout },
  );

  // Mark implemented on the worktree's plan before the final bookkeeping commit.
  updatePlanJson(taskPlanFile, (d) => {
    const t = findTask(d, taskId);
    if (t) {
      t.status = "implemented";
      t.errors = [];
      delete t.stage;
      const devResult = (cycleResult.devResult as { summary?: string } | undefined);
      if (devResult?.summary) {
        t.summary = devResult.summary;
      }
    }
  });

  const bookkeep = commitPlanFile(taskWriteCwd, taskPlanFile, `chore(plan): record ${taskId} progress`);
  if (!bookkeep.ok && !bookkeep.skipped) {
    log(`Warning: bookkeeping commit failed for ${taskId}: ${bookkeep.error}`);
  }
  if (worktree) {
    await maybePushAfterCommit(settings, `bookkeeping ${taskId}`, taskCwd);
  }

  // Merge to remote base. On parallelism, plan.json conflicts are auto-resolved
  // via the reconcile path inside mergeWorktreeBranch.
  if (worktree) {
    const mergeResult = await mergeWorktree(
      hooks,
      projectRoot,
      worktree,
      planFile,
      taskId,
      settings,
      planName,
      planRelativePath(projectRoot, planFile),
      gitMutex,
    );
    if (!mergeResult.ok) {
      log(`Task ${taskId}: worktree merge failed — worktree preserved at ${worktree.worktreePath}`);
      return {
        taskId,
        outcome: "merge_failed",
        error: mergeResult.error ?? "Worktree merge failed",
        worktree,
        worktreeFinalState: safeReadPlan(taskPlanFile),
      };
    }
  }

  log(`Task ${taskId}: implemented`);
  return {
    taskId,
    outcome: "ok",
    worktree: worktree ?? undefined,
    worktreeFinalState: safeReadPlan(taskPlanFile),
    summary: (cycleResult.devResult as { summary?: string } | undefined)?.summary,
  };
}

function extractAggregateSummary(planFile: string, taskId: string): string {
  const data = safeReadPlan(planFile);
  if (!data) return "";
  const task = findTask(data, taskId);
  if (!task?.sub_tasks) return task?.summary ?? "";
  return task.sub_tasks
    .filter((st) => st.summary)
    .map((st) => st.summary as string)
    .join("\n");
}

function safeReadPlan(planFile: string): PlanData | undefined {
  try {
    return readPlan(planFile);
  } catch {
    return undefined;
  }
}

/**
 * Run a recovery worker in its own worktree. Fresh worktree from
 * `remote/<base>`, runs runRecoverySession inside it, then removes the
 * worktree on success. On success, the scheduler resets the task back to
 * pending so it re-enters the ready set.
 */
export async function runRecoveryWorker(inputs: {
  hooks: HookMap;
  projectRoot: string;
  planFile: string;
  planName: string;
  settings: Settings;
  taskId: string;
  gitMutex?: AsyncMutex;
  priorSummaries: string[];
  error: string;
  planStateSnapshot: PlanData;
}): Promise<{ taskId: string; outcome: "recovered" | "recovery_failed"; error?: string }> {
  return taskContext.run({ taskId: `${inputs.taskId}+recovery` }, () => runRecoveryWorkerInner(inputs));
}

async function runRecoveryWorkerInner(inputs: {
  hooks: HookMap;
  projectRoot: string;
  planFile: string;
  planName: string;
  settings: Settings;
  taskId: string;
  gitMutex?: AsyncMutex;
  priorSummaries: string[];
  error: string;
  planStateSnapshot: PlanData;
}): Promise<{ taskId: string; outcome: "recovered" | "recovery_failed"; error?: string }> {
  const { hooks, projectRoot, planFile, planName, settings, taskId, gitMutex, priorSummaries, error, planStateSnapshot } = inputs;

  const baseBranch = planStateSnapshot.base_branch || "main";
  const recoveryBranchTag = `${taskId}-recovery`;

  // Recovery runs in its own fresh worktree. We reuse setupWorktree but pass
  // a synthetic task id so branch names don't collide with the main task.
  const worktree = await setupWorktree(
    hooks,
    projectRoot,
    planName,
    recoveryBranchTag,
    baseBranch,
    planFile,
    settings,
    false,
    gitMutex,
  );
  if (!worktree) {
    return { taskId, outcome: "recovery_failed", error: "Failed to create recovery worktree" };
  }

  const recoveryContext: RecoveryContext = {
    plan_path: planFile,
    plan_name: planName,
    failed_task_id: taskId,
    failed_stage: "halted",
    error,
    build: buildBuildContext(planFile, planName, "halted"),
    prior_summaries: priorSummaries,
    cycle_count: MAX_DEV_CYCLES,
  };

  const recovery = await runRecoverySession(worktree.worktreePath, recoveryContext);

  if (!recovery.ok) {
    return {
      taskId,
      outcome: "recovery_failed",
      error: recovery.structured?.error ?? "Recovery session failed",
    };
  }

  // Recovery committed changes to its worktree branch; push + merge to base.
  await maybePushAfterCommit(settings, `recovery ${taskId}`, worktree.worktreePath);

  const mergeResult = await mergeWorktree(
    hooks,
    projectRoot,
    worktree,
    planFile,
    taskId,
    settings,
    planName,
    planRelativePath(projectRoot, planFile),
    gitMutex,
  );
  if (!mergeResult.ok) {
    return {
      taskId,
      outcome: "recovery_failed",
      error: `Recovery merge failed: ${mergeResult.error ?? "unknown"}`,
    };
  }

  return { taskId, outcome: "recovered" };
}
