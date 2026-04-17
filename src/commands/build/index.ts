import { existsSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { buildEndHeading, statsLine } from "../../lib/format.js";
import { checkBaseSync, planRelativePath } from "../../lib/git.js";
import { enableTaskPrefix } from "../../lib/log-context.js";
import { closeLogger, initLogger } from "../../lib/logger.js";
import { promptYesNo, type SyncAnswer } from "../../lib/prompt.js";
import { log, logDetail, resolveProjectRoot } from "../../lib/utils.js";
import type { BuildStage, HookMap, Settings } from "../../types.js";
import { buildStats, formatDuration } from "../lib/claude.js";
import { discoverHooks, tryHook, validateMandatoryHooks } from "../lib/hooks.js";
import { buildBuildContext } from "./cycle.js";
import {
  readPlan,
  readSettings,
  resolvePlanFile,
  updatePlanLevelStatus,
  writePlan,
} from "./plan-data.js";
import { PlanState } from "./plan-state.js";
import { updatePrdStatuses } from "./prd.js";
import { runHealthcheckHook } from "./sessions.js";
import { runScheduler } from "./scheduler.js";
import { sweepActiveWorktrees } from "./worktree-registry.js";

export interface RunBuildOptions {
  resume?: boolean;
  noWorktrees?: boolean;
  parallel?: number;
  failureThreshold?: number;
  syncAnswer?: SyncAnswer;
}

async function fireHalt(
  hooks: HookMap,
  planFile: string,
  planName: string,
  issues: string[],
  settings: Settings,
): Promise<void> {
  log(`BUILD HALTED: ${issues.length} healthcheck issue(s)`);
  sweepActiveWorktrees("halt");
  await tryHook(
    hooks,
    "halt",
    {
      build: buildBuildContext(planFile, planName, "halted"),
      issues,
    },
    { timeout: settings.hookTimeout },
  );
}

/**
 * Build command entry point.
 */
export async function runBuild(planName: string, opts: RunBuildOptions = {}): Promise<void> {
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

  let settings = readSettings(projectRoot);
  if (typeof opts.parallel === "number") {
    settings = { ...settings, maxParallel: Math.max(1, Math.min(16, opts.parallel)) };
  }
  if (typeof opts.failureThreshold === "number") {
    settings = { ...settings, failureThreshold: Math.max(1, Math.min(100, opts.failureThreshold)) };
  }

  enableTaskPrefix(settings.maxParallel > 1);

  await runAllTasksMode(
    hooks,
    projectRoot,
    planRelative,
    planFile,
    planDir,
    settings,
    opts.resume ?? false,
    opts.noWorktrees ?? false,
    opts.syncAnswer,
  );
}

// ── Main Orchestrator ──

async function runAllTasksMode(
  hooks: HookMap,
  projectRoot: string,
  planName: string,
  planFile: string,
  _planDir: string,
  settings: Settings,
  resume: boolean,
  noWorktrees: boolean,
  syncAnswer: SyncAnswer,
): Promise<void> {
  log(`Starting build: all pending tasks from ${planName}`);
  log(`Parallelism: ${settings.maxParallel} worker(s), failure threshold: ${settings.failureThreshold}`);

  const diskData = readPlan(planFile);
  const baseBranch = diskData.base_branch || "main";

  // Startup sync check: projectRoot must be on base_branch, plan.json clean,
  // and local base in sync with remote (or brought in sync interactively).
  const syncOutcome = await checkBaseSync(
    projectRoot,
    settings.remote,
    baseBranch,
    planRelativePath(projectRoot, planFile),
    (question) => promptYesNo(question, { syncAnswer }),
  );
  if (!syncOutcome.ok) {
    log(`BUILD ABORTED: ${syncOutcome.message}`);
    process.exit(1);
  }
  if (syncOutcome.action !== "in-sync") {
    log(`Base sync: ${syncOutcome.action}`);
  }

  // Reset failed tasks on the in-memory plan (unless resuming). No commit —
  // the on-disk plan.json is frozen until build end.
  const freshData = readPlan(planFile);
  if (!resume) {
    for (const t of freshData.tasks) {
      if (t.status === "failed") {
        t.status = "pending";
        t.errors = [];
        delete t.stage;
      }
      if (t.sub_tasks) {
        for (const st of t.sub_tasks) {
          if (st.status === "failed") {
            st.status = "pending";
            st.errors = [];
            delete st.stage;
          }
        }
      }
    }
    if (freshData.status === "failed") freshData.status = "pending";
  }

  const planState = new PlanState(freshData);

  // Snapshot tasks that were in_progress at start — those get resume=true so
  // setupWorktree reattaches rather than creating a fresh branch.
  const resumeTaskIds = new Set<string>();
  if (resume) {
    for (const t of freshData.tasks) {
      if (t.status === "in_progress") resumeTaskIds.add(t.id);
    }
  }

  planState.setPlanStatus("in_progress");

  // Start hook (optional).
  const startResult = await tryHook(
    hooks,
    "start",
    { build: buildBuildContext(planFile, planName, "start") },
    { timeout: settings.hookTimeout },
  );
  if (startResult && !startResult.ok) {
    log(`BUILD ABORTED: start hook failed — ${startResult.stderr}`);
    planState.setPlanStatus("failed");
    flushPlanToDisk(planFile, planState);
    process.exit(1);
  }

  // Pre-scheduler healthcheck (infra preflight).
  const healthAfterStart = await runHealthcheckHook(hooks, {
    planFile,
    planName,
    stage: "start",
    settings,
    cwd: projectRoot,
  });
  if (!healthAfterStart.ok) {
    await fireHalt(hooks, planFile, planName, healthAfterStart.issues, settings);
    flushPlanToDisk(planFile, planState);
    process.exit(1);
  }

  const taskCount = freshData.tasks.length;

  const schedulerResult = await runScheduler({
    hooks,
    projectRoot,
    planFile,
    planName,
    settings,
    planState,
    resume,
    noWorktrees,
    resumeTaskIds,
  });

  const { doneCount, failedCount, drainedEarly, blockedTaskIds } = schedulerResult;

  if (drainedEarly || blockedTaskIds.length > 0) {
    const snap = planState.snapshot();
    const failedIds = snap.tasks.filter((t) => t.status === "failed").map((t) => t.id);
    const issues = drainedEarly
      ? [`Failure threshold reached — ${failedIds.length} task(s) failed: ${failedIds.join(", ")}`]
      : [`Deadlock — ${blockedTaskIds.length} task(s) blocked by failed deps: ${blockedTaskIds.join(", ")}`];
    await fireHalt(hooks, planFile, planName, issues, settings);
  }

  // PRD status update after a fully-clean run.
  if (failedCount === 0 && doneCount === taskCount) {
    // Flush before the PRD scan so readPlan in prd.ts sees final state.
    flushPlanToDisk(planFile, planState);
    updatePrdStatuses(projectRoot, planFile);
  }

  // Stop hook (optional).
  const stopStage: BuildStage = failedCount > 0 ? "failed" : "stop";
  await tryHook(
    hooks,
    "stop",
    { build: buildBuildContext(planFile, planName, stopStage) },
    { timeout: settings.hookTimeout },
  );

  // Final plan.json flush — no commit. The user can inspect it; remote state
  // is the source of truth for each task branch.
  flushPlanLevelStatus(planFile, planState, taskCount, doneCount, failedCount);

  // Completion report
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
  if (drainedEarly) {
    logDetail(`Build drained early after reaching failure threshold.`);
  }
  if (blockedTaskIds.length > 0) {
    logDetail(`Unattempted (blocked by failed deps): ${blockedTaskIds.join(", ")}`);
  }
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

function flushPlanToDisk(planFile: string, planState: PlanState): void {
  try {
    writePlan(planFile, planState.snapshot());
  } catch (err) {
    log(`Warning: failed to flush plan.json to disk: ${(err as Error).message}`);
  }
}

function flushPlanLevelStatus(
  planFile: string,
  planState: PlanState,
  taskCount: number,
  doneCount: number,
  failedCount: number,
): void {
  if (doneCount === taskCount) {
    planState.setPlanStatus("implemented");
  } else if (failedCount > 0) {
    planState.setPlanStatus("failed");
  }
  flushPlanToDisk(planFile, planState);
  // Reuse updatePlanLevelStatus for any side-effects consumers may rely on.
  updatePlanLevelStatus(planFile, taskCount, doneCount, failedCount);
}
