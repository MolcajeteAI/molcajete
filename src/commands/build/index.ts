import { existsSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { MAX_DEV_CYCLES } from "../../lib/config.js";
import { buildEndHeading, statsLine, taskHeading } from "../../lib/format.js";
import { commitPlanFile } from "../../lib/git.js";
import { closeLogger, initLogger } from "../../lib/logger.js";
import { log, logDetail, resolveProjectRoot } from "../../lib/utils.js";
import type { BuildStage, HookMap, RecoveryContext, Settings, WorktreeInfo } from "../../types.js";
import { buildStats, formatDuration } from "../lib/claude.js";
import { discoverHooks, tryHook, validateMandatoryHooks } from "../lib/hooks.js";
import { buildBuildContext } from "./cycle.js";
import {
  findTask,
  readPlan,
  readSettings,
  resolvePlanFile,
  updatePlanJson,
  updatePlanLevelStatus,
  worktreePlanFile,
} from "./plan-data.js";
import { updatePrdStatuses } from "./prd.js";
import { commitDocChanges, maybePushAfterCommit, runDocSession, runRecoverySession } from "./sessions.js";
import { runSimpleTask, runTaskWithSubTasks } from "./tasks.js";
import { mergeWorktree, setupWorktree } from "./worktree.js";

/**
 * Stage and commit a plan.json write. Skips silently when no diff exists.
 * Logs a warning on commit failure but never throws — the plan write itself
 * still succeeded, and a missed commit will surface next iteration.
 */
function commitPlan(cwd: string, planFile: string, message: string): void {
  const result = commitPlanFile(cwd, planFile, message);
  if (!result.ok) {
    log(`Warning: failed to commit plan update (${message}): ${result.error}`);
  }
}

/**
 * Build command entry point.
 */
export async function runBuild(planName: string, opts: { resume?: boolean; noWorktrees?: boolean }): Promise<void> {
  const projectRoot = resolveProjectRoot();

  // Resolve plan file
  const plansDir = resolve(projectRoot, ".molcajete", "plans");
  if (!existsSync(plansDir)) {
    process.stderr.write("Error: .molcajete/plans/ directory not found\n");
    process.exit(1);
  }

  const planFile = resolvePlanFile(plansDir, planName);
  if (!planFile) {
    const available = readdirSync(plansDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(plansDir, e.name, "plan.json")))
      .map((e) => e.name)
      .join("\n  ");
    process.stderr.write(`Error: plan not found: ${planName}\n\nAvailable plans:\n  ${available || "(none)"}\n`);
    process.exit(1);
  }
  const planDir = dirname(planFile);
  const planRelative = basename(planDir);

  const logPath = initLogger("build", planRelative);
  logDetail(`Logs: ${logPath}`);

  const hooks = await discoverHooks(projectRoot);
  validateMandatoryHooks(hooks);

  const settings = readSettings(projectRoot);

  await runAllTasksMode(
    hooks,
    projectRoot,
    planRelative,
    planFile,
    planDir,
    settings,
    opts.resume ?? false,
    opts.noWorktrees ?? false,
  );
}

// ── Helpers ──

function extractSummary(result: Record<string, unknown>, planFile: string, taskId: string): string {
  const devResult = result.devResult as { summary?: string } | undefined;
  if (devResult?.summary) return devResult.summary;
  const data = readPlan(planFile);
  const task = findTask(data, taskId);
  if (!task?.sub_tasks) return "";
  return task.sub_tasks
    .filter((st) => st.summary)
    .map((st) => st.summary as string)
    .join("\n");
}

// ── Main Orchestrator Loop ──

async function runAllTasksMode(
  hooks: HookMap,
  projectRoot: string,
  planName: string,
  planFile: string,
  planDir: string,
  settings: Settings,
  resume: boolean,
  noWorktrees: boolean,
): Promise<void> {
  log(`Starting build: all pending tasks from ${planName}`);

  if (!resume) {
    // Reset failed tasks back to pending so they are retried
    updatePlanJson(planFile, (d) => {
      for (const t of d.tasks) {
        if (t.status === "failed") {
          t.status = "pending";
          t.errors = [];
        }
        if (t.sub_tasks) {
          for (const st of t.sub_tasks) {
            if (st.status === "failed") {
              st.status = "pending";
              st.errors = [];
            }
          }
        }
      }
      if (d.status === "failed") d.status = "pending";
    });
    commitPlan(projectRoot, planFile, "chore(plan): reset failed tasks");
  }

  const data = readPlan(planFile);

  // Snapshot tasks that were already in_progress when the build started.
  // Only these get resume=true (attach to existing branch); pending/failed
  // tasks use the default path so a fresh branch can be created from base.
  // Snapshot at start because the loop flips tasks to in_progress just
  // before running them.
  const resumeTaskIds = new Set<string>();
  if (resume) {
    for (const t of data.tasks) {
      if (t.status === "in_progress") {
        resumeTaskIds.add(t.id);
      }
    }
  }

  // Start hook (optional) — developer sets up environment
  const startResult = await tryHook(
    hooks,
    "start",
    {
      build: buildBuildContext(planFile, planName, "start"),
    },
    { timeout: settings.hookTimeout },
  );
  if (startResult && !startResult.ok) {
    log(`BUILD ABORTED: start hook failed — ${startResult.stderr}`);
    updatePlanJson(planFile, (d) => {
      d.status = "failed";
    });
    commitPlan(projectRoot, planFile, "chore(plan): mark plan failed (start hook)");
    process.exit(1);
  }

  // Task Loop
  const taskCount = data.tasks.length;
  let doneCount = 0;
  let failedCount = 0;

  for (const task of data.tasks) {
    if (task.status === "implemented") doneCount++;
  }

  updatePlanJson(planFile, (d) => {
    d.status = "in_progress";
  });
  commitPlan(projectRoot, planFile, "chore(plan): mark plan in progress");

  const recoveredTasks = new Set<string>();
  let taskIndex = 0;

  while (taskIndex < data.tasks.length) {
    const taskId = data.tasks[taskIndex].id;
    taskIndex++;

    const freshData = readPlan(planFile);
    const freshTask = findTask(freshData, taskId);
    if (!freshTask) continue;

    if (freshTask.status === "implemented") continue;

    {
      const h = taskHeading(taskId, freshTask.title);
      log(h.title);
      logDetail(h.rule);
    }

    // Check dependencies
    const { checkDependencies } = await import("./plan-data.js");
    const depResult = checkDependencies(freshData, taskId);

    if (depResult === 1) {
      log(`Skipping ${taskId}: dependency failed — stopping build`);
      break;
    }

    if (depResult === 2) {
      log(`Skipping ${taskId}: dependency not yet implemented`);
      continue;
    }

    updatePlanJson(planFile, (d) => {
      const t = findTask(d, taskId);
      if (t) t.status = "in_progress";
    });
    // Commit before worktree setup so the worktree branches from a tip that
    // already records the in_progress status (resume relies on this).
    commitPlan(projectRoot, planFile, `chore(plan): mark ${taskId} in progress`);

    // Collect prior summaries
    const priorSummaries: string[] = [];
    for (const t of freshData.tasks) {
      if (t.status === "implemented" && t.summary) {
        priorSummaries.push(t.summary);
      }
    }

    // Worktree setup
    const useWorktrees = !noWorktrees;
    const baseBranch = freshData.base_branch || "main";
    let worktree: WorktreeInfo | null = null;
    let taskCwd: string | undefined;

    if (useWorktrees) {
      const taskResume = resumeTaskIds.has(taskId);
      worktree = await setupWorktree(hooks, projectRoot, planName, taskId, baseBranch, planFile, settings, taskResume);
      if (!worktree) {
        updatePlanJson(planFile, (d) => {
          const t = findTask(d, taskId);
          if (t) {
            t.status = "failed";
            t.errors = ["Failed to create worktree"];
          }
        });
        commitPlan(projectRoot, planFile, `chore(plan): mark ${taskId} failed (worktree setup)`);
        failedCount++;
        break;
      }
      taskCwd = worktree.worktreePath;
    }

    const taskBranch = worktree?.branchName;
    // All per-task plan/report writes target the worktree's copy when one
    // exists. The single bookkeeping commit at the end of the task flushes
    // them; the FF merge then promotes them onto the base branch.
    const taskPlanFile = worktree ? worktreePlanFile(planFile, projectRoot, worktree.worktreePath) : planFile;
    const taskPlanDir = worktree ? dirname(taskPlanFile) : planDir;
    const taskWriteCwd = worktree ? worktree.worktreePath : projectRoot;

    let result: { ok: boolean; error?: string };
    if (freshTask.sub_tasks && freshTask.sub_tasks.length > 0) {
      result = await runTaskWithSubTasks(
        hooks,
        projectRoot,
        taskPlanFile,
        freshTask,
        priorSummaries,
        taskPlanDir,
        settings,
        planName,
        taskCwd,
        taskBranch,
      );
    } else {
      result = await runSimpleTask(
        hooks,
        projectRoot,
        taskPlanFile,
        freshTask,
        priorSummaries,
        taskPlanDir,
        settings,
        planName,
        taskCwd,
        taskBranch,
      );
    }

    if (result.ok) {
      // 1. Extract summary for doc session (reads from worktree's plan when active)
      const taskSummary = extractSummary(result as Record<string, unknown>, taskPlanFile, taskId);

      // 2. Doc session — in worktree, before merge
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

      const doc = await runDocSession(
        projectRoot,
        taskPlanFile,
        freshTask,
        [...priorSummaries, taskSummary].join("\n"),
        [],
        planName,
        taskCwd,
      );
      if (doc.ok && doc.structured?.files_modified?.length > 0) {
        await commitDocChanges(freshTask.id, doc.structured.files_modified, taskCwd);
        maybePushAfterCommit(settings, `doc ${taskId}`, taskCwd);
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

      // 3. Mark implemented in the worktree's plan (or dev's, if no worktree)
      updatePlanJson(taskPlanFile, (d) => {
        const t = findTask(d, taskId);
        if (t) {
          t.status = "implemented";
          t.errors = [];
          const devResult = (result as Record<string, unknown>).devResult as { summary?: string } | undefined;
          if (devResult?.summary) {
            t.summary = devResult.summary;
          }
        }
      });

      // 4. Bookkeeping commit — flushes mark-implemented + any sub-task status
      // updates accumulated during the cycle. Lives on the worktree branch and
      // is promoted to the base branch by the FF merge below.
      commitPlan(taskWriteCwd, taskPlanFile, `chore(plan): record ${taskId} progress`);
      if (worktree) {
        maybePushAfterCommit(settings, `bookkeeping ${taskId}`, taskCwd);
      }

      // 5. Merge worktree (FF only — promotes doc + bookkeeping commits to base)
      if (worktree) {
        const mergeResult = await mergeWorktree(hooks, projectRoot, worktree, planFile, taskId, settings, planName);
        if (!mergeResult.ok) {
          log(`Task ${taskId}: worktree merge failed — worktree preserved at ${worktree.worktreePath}`);
          // Worktree retains the implemented status; record the failure on the
          // base branch so resume sees the correct state next run.
          updatePlanJson(planFile, (d) => {
            const t = findTask(d, taskId);
            if (t) {
              t.status = "failed";
              t.errors = [mergeResult.error || "Worktree merge failed"];
            }
          });
          commitPlan(projectRoot, planFile, `chore(plan): mark ${taskId} merge-failed`);
          failedCount++;
          break;
        }
        maybePushAfterCommit(settings, `merge ${taskId}`);
      }

      doneCount++;
      log(`Task ${taskId}: implemented`);
    } else {
      // Preserve worktree on failure for debugging
      if (worktree) {
        log(`Task ${taskId}: failed — worktree preserved at ${worktree.worktreePath}`);
      }

      updatePlanJson(planFile, (d) => {
        const t = findTask(d, taskId);
        if (t) {
          t.status = "failed";
          t.errors = [result.error || "Task failed"];
        }
      });
      commitPlan(projectRoot, planFile, `chore(plan): mark ${taskId} failed`);

      // Attempt recovery if not already recovered this task
      if (recoveredTasks.has(taskId)) {
        log(`Task ${taskId}: already recovered once — giving up`);
        failedCount++;
        break;
      }

      log(`Task ${taskId}: failed — attempting recovery`);
      recoveredTasks.add(taskId);

      const recoveryContext: RecoveryContext = {
        plan_path: planFile,
        plan_name: planName,
        failed_task_id: taskId,
        failed_stage: "halted",
        error: result.error || "Task failed",
        build: buildBuildContext(planFile, planName, "halted"),
        prior_summaries: priorSummaries,
        cycle_count: MAX_DEV_CYCLES,
      };

      // Fire halted hook (informational)
      await tryHook(
        hooks,
        "stop",
        {
          build: buildBuildContext(planFile, planName, "halted"),
        },
        { timeout: settings.hookTimeout },
      );

      const recovery = await runRecoverySession(projectRoot, recoveryContext);

      if (recovery.ok) {
        maybePushAfterCommit(settings, `recovery ${taskId}`);
        log(`Recovery succeeded for ${taskId} — resetting task to pending`);
        updatePlanJson(planFile, (d) => {
          const t = findTask(d, taskId);
          if (t) {
            t.status = "pending";
            t.errors = [];
            if (t.sub_tasks) {
              for (const st of t.sub_tasks) {
                if (st.status === "failed") {
                  st.status = "pending";
                  st.errors = [];
                }
              }
            }
          }
        });
        commitPlan(projectRoot, planFile, `chore(plan): reset ${taskId} after recovery`);
        taskIndex--;
        continue;
      }

      log(`Recovery failed for ${taskId} — stopping build`);
      failedCount++;
      break;
    }
  }

  // PRD status update after all tasks pass
  if (failedCount === 0 && doneCount === taskCount) {
    updatePrdStatuses(projectRoot, planFile);
  }

  // Stop hook (optional) — developer tears down environment
  const stopStage: BuildStage = failedCount > 0 ? "failed" : "stop";
  await tryHook(
    hooks,
    "stop",
    {
      build: buildBuildContext(planFile, planName, stopStage),
    },
    { timeout: settings.hookTimeout },
  );

  updatePlanLevelStatus(planFile, taskCount, doneCount, failedCount);
  commitPlan(projectRoot, planFile, "chore(plan): finalize plan status");

  // Completion Report
  {
    const h = buildEndHeading();
    log(h.title);
    logDetail(h.rule);
  }
  logDetail(
    statsLine([
      ["Implemented", String(doneCount)],
      ["Failed", String(failedCount)],
      ["Total", String(taskCount)],
    ]),
  );
  if (buildStats.sessions > 0) {
    logDetail(
      statsLine([
        ["Sessions", String(buildStats.sessions)],
        ["Elapsed", formatDuration(buildStats.totalApiMs)],
        ["Real", formatDuration(buildStats.totalRealMs)],
        ["Cost", `$${buildStats.totalCostUsd.toFixed(4)}`],
      ]),
    );
  }

  process.stdout.write("\nTask Status:\n");
  const finalData = readPlan(planFile);
  for (const task of finalData.tasks) {
    const status = task.status.padEnd(12);
    const error = task.errors?.length ? ` (${task.errors.join("; ")})` : "";
    process.stdout.write(`  ${task.id.padEnd(10)}  ${status} ${task.title}${error}\n`);

    if (task.sub_tasks) {
      for (const st of task.sub_tasks) {
        const stStatus = st.status.padEnd(12);
        const stError = st.errors?.length ? ` (${st.errors.join("; ")})` : "";
        process.stdout.write(`    ${st.id.padEnd(14)}  ${stStatus} ${st.title}${stError}\n`);
      }
    }
  }

  closeLogger();
  process.exit(failedCount === 0 ? 0 : 1);
}
