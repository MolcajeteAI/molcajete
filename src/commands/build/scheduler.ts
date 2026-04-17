import { type AsyncMutex, createMutex } from "../../lib/async-mutex.js";
import { log } from "../../lib/utils.js";
import type { HookMap, ReviewLevel, Settings } from "../../types.js";
import { type BoundaryReviewResult, resolveReviewAction, runBoundaryReview, taskIdsForBoundary } from "./boundary-review.js";
import { getDoneItems, triggerDoneHooks } from "./done-items.js";
import type { PlanState } from "./plan-state.js";
import { runRecoveryWorker, runTaskWorker, type WorkerResult } from "./worker.js";

export interface SchedulerInputs {
  hooks: HookMap;
  projectRoot: string;
  planFile: string;
  planName: string;
  settings: Settings;
  planState: PlanState;
  resume: boolean;
  /**
   * Task ids that were `in_progress` on disk when the build started. Those are
   * launched in resume mode so their existing worktree/branch is reattached.
   */
  resumeTaskIds: Set<string>;
  skipDocs: boolean;
  skipReview: boolean;
  reviewLevels: Set<ReviewLevel>;
}

export interface SchedulerResult {
  doneCount: number;
  failedCount: number;
  drainedEarly: boolean;
  /** Task ids that couldn't be attempted because a dependency failed. */
  blockedTaskIds: string[];
}

/**
 * DAG scheduler — launches up to `settings.maxParallel` workers concurrently,
 * respecting task dependencies. Terminal failures accumulate against a
 * threshold; once reached, the scheduler drains in-flight work and exits.
 *
 * Recovery runs as its own worker in its own worktree (no serialization
 * needed beyond gitMutex for worktree add/remove).
 */
export async function runScheduler(inputs: SchedulerInputs): Promise<SchedulerResult> {
  const { hooks, projectRoot, planFile, planName, settings, planState, resume, resumeTaskIds, skipDocs, skipReview, reviewLevels } = inputs;

  const gitMutex: AsyncMutex = createMutex();
  const maxParallel = Math.max(1, settings.maxParallel);
  const effectiveThreshold = maxParallel === 1 ? 1 : Math.max(1, settings.failureThreshold);

  const recoveredTasks = new Set<string>();
  const reviewedBoundaries = new Set<string>(); // "usecase:UC-001", "feature:FEAT-001", etc.
  const inflight = new Map<string, Promise<{ kind: "task" | "recovery" | "boundary-review"; result: unknown }>>();

  let doneCount = 0;
  let failedCount = 0;
  let terminalFailures = 0;
  let recoveriesInFlight = 0;
  let draining = false;

  // Count tasks already implemented so doneCount reflects plan state at entry.
  {
    const snap = planState.snapshot();
    for (const t of snap.tasks) {
      if (t.status === "implemented") doneCount++;
    }
  }

  const launchTask = (taskId: string): void => {
    planState.markInProgress(taskId);
    const snapshot = planState.snapshot();
    const priorSummaries: string[] = [];
    for (const t of snapshot.tasks) {
      if (t.status === "implemented" && t.summary) priorSummaries.push(t.summary);
    }
    const p = runTaskWorker({
      hooks,
      projectRoot,
      planFile,
      planName,
      settings,
      taskId,
      resume: resume && resumeTaskIds.has(taskId),
      skipDocs,
      gitMutex,
      planStateSnapshot: snapshot,
      priorSummaries,
    }).then((result) => ({ kind: "task" as const, result }));
    inflight.set(taskId, p);
  };

  const launchRecovery = (taskId: string, error: string): void => {
    const snapshot = planState.snapshot();
    const priorSummaries: string[] = [];
    for (const t of snapshot.tasks) {
      if (t.status === "implemented" && t.summary) priorSummaries.push(t.summary);
    }
    const key = `recovery:${taskId}`;
    const p = runRecoveryWorker({
      hooks,
      projectRoot,
      planFile,
      planName,
      settings,
      taskId,
      gitMutex,
      priorSummaries,
      error,
      planStateSnapshot: snapshot,
    }).then((result) => ({ kind: "recovery" as const, result }));
    inflight.set(key, p);
  };

  const launchBoundaryReview = (taskId: string): void => {
    const snap = planState.snapshot();
    const doneItems = getDoneItems(snap, taskId);

    // Always fire done hooks (regardless of --skip-review)
    triggerDoneHooks(hooks, doneItems, planFile, planName, settings).catch(() => {
      // Hook failures are non-fatal for done hooks
    });

    if (skipReview || draining) return;

    const action = resolveReviewAction(doneItems, reviewLevels);
    if (!action) return;

    const boundaryKey = `${action.level}:${action.boundaryId}`;
    if (reviewedBoundaries.has(boundaryKey)) return;
    reviewedBoundaries.add(boundaryKey);

    const taskIds = taskIdsForBoundary(snap, action.level, action.boundaryId);
    const inflightKey = `boundary-review:${boundaryKey}`;

    log(`Launching ${action.level}-level boundary review for ${action.boundaryId} (mode: ${action.mode})`);

    const p = runBoundaryReview(
      hooks,
      projectRoot,
      planFile,
      taskIds,
      action.level,
      action.boundaryId,
      action.mode,
      settings,
      planName,
    ).then((result) => ({ kind: "boundary-review" as const, result }));
    inflight.set(inflightKey, p);
  };

  const handleBoundaryReviewResult = (result: BoundaryReviewResult): void => {
    if (result.issues.length > 0) {
      log(`Boundary review ${result.level} ${result.boundaryId}: ${result.issues.length} issue(s) logged as warnings`);
    }
  };

  const handleTaskResult = (result: WorkerResult): void => {
    if (result.outcome === "ok") {
      if (result.worktreeFinalState) {
        planState.mergeWorkerResult(result.taskId, result.worktreeFinalState);
      }
      doneCount++;
      launchBoundaryReview(result.taskId);
      return;
    }

    if (result.outcome === "merge_failed") {
      if (result.worktreeFinalState) {
        planState.mergeWorkerResult(result.taskId, result.worktreeFinalState);
      }
      planState.markMergeFailed(result.taskId, result.error ?? "Worktree merge failed");
      failedCount++;
      terminalFailures++;
      return;
    }

    if (result.outcome === "infra_failed") {
      planState.markFailed(result.taskId, [result.error ?? "Infra failure"]);
      failedCount++;
      terminalFailures++;
      return;
    }

    // dev_failed → attempt recovery, unless the task already recovered once.
    if (result.worktreeFinalState) {
      planState.mergeWorkerResult(result.taskId, result.worktreeFinalState);
    }
    planState.markFailed(result.taskId, [result.error ?? "Task failed"]);

    if (recoveredTasks.has(result.taskId) || draining) {
      failedCount++;
      terminalFailures++;
      return;
    }

    recoveredTasks.add(result.taskId);
    recoveriesInFlight++;
    log(`Task ${result.taskId}: failed — launching recovery`);
    launchRecovery(result.taskId, result.error ?? "Task failed");
  };

  const handleRecoveryResult = (result: { taskId: string; outcome: "recovered" | "recovery_failed"; error?: string }): void => {
    recoveriesInFlight--;
    if (result.outcome === "recovered") {
      log(`Recovery succeeded for ${result.taskId} — re-queuing`);
      planState.resetForRecovery(result.taskId);
      return;
    }
    const error = result.error ?? "Recovery failed";
    log(`Recovery failed for ${result.taskId}: ${error}`);
    planState.markFailed(result.taskId, [error]);
    failedCount++;
    terminalFailures++;
  };

  while (true) {
    // Launch phase — fill up to maxParallel from the ready set.
    // Hold launches while any recovery is in-flight to avoid piling on work
    // when the build is struggling.
    if (!draining && recoveriesInFlight === 0) {
      while (inflight.size < maxParallel) {
        const readyIds = planState.readyTaskIds();
        const alreadyLaunched = new Set(inflight.keys());
        const next = readyIds.find((id) => !alreadyLaunched.has(id));
        if (!next) break;
        launchTask(next);
      }
    }

    if (inflight.size === 0) {
      // Nothing in flight: either we're fully done, or deadlocked.
      if (draining) break;
      const remaining = planState.unimplementedTaskIds();
      if (remaining.length === 0) break;

      // Filter out tasks blocked by failed deps — they're not launchable.
      const blocked = remaining.filter((id) => planState.hasFailedDependency(id));
      const stillReady = planState.readyTaskIds();
      if (stillReady.length === 0) {
        if (blocked.length > 0) {
          log(`Deadlock: ${blocked.length} task(s) blocked by failed dependencies: ${blocked.join(", ")}`);
        } else {
          log(`Deadlock: ${remaining.length} task(s) cannot start (circular or missing dependencies)`);
        }
        return {
          doneCount,
          failedCount,
          drainedEarly: false,
          blockedTaskIds: remaining,
        };
      }
      // If stillReady is non-empty we loop back and launch them next tick.
      continue;
    }

    // Await whichever worker finishes first.
    const promises = Array.from(inflight.entries()).map(async ([key, p]) => ({ key, payload: await p }));
    const winner = await Promise.race(promises);
    inflight.delete(winner.key);

    if (winner.payload.kind === "task") {
      handleTaskResult(winner.payload.result as WorkerResult);
    } else if (winner.payload.kind === "recovery") {
      handleRecoveryResult(winner.payload.result as { taskId: string; outcome: "recovered" | "recovery_failed"; error?: string });
    } else {
      handleBoundaryReviewResult(winner.payload.result as BoundaryReviewResult);
    }

    if (!draining && terminalFailures >= effectiveThreshold) {
      log(
        `Failure threshold reached (${terminalFailures}/${effectiveThreshold}) — draining in-flight tasks and stopping`,
      );
      draining = true;
    }
  }

  return {
    doneCount,
    failedCount,
    drainedEarly: draining,
    blockedTaskIds: planState.unimplementedTaskIds(),
  };
}
