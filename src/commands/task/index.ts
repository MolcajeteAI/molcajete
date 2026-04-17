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
import { buildBuildContext } from "../build/cycle.js";
import {
  expandTaskNumbers,
  findTask,
  readPlan,
  readSettings,
  resolvePlanFile,
  resolveTransitiveDeps,
  updatePlanLevelStatus,
  writePlan,
} from "../build/plan-data.js";
import { PlanState } from "../build/plan-state.js";
import { updatePrdStatuses } from "../build/prd.js";
import { runHealthcheckHook } from "../build/sessions.js";
import { runScheduler } from "../build/scheduler.js";
import { sweepActiveWorktrees } from "../build/worktree-registry.js";
import {
  fireHalt,
  flushPlanLevelStatus,
  flushPlanToDisk,
  parseReviewLevels,
} from "../build/index.js";

export interface RunTaskOptions {
  resume?: boolean;
  parallel?: number;
  maxFailures?: number;
  buildDeps?: boolean;
  syncAnswer?: SyncAnswer;
  skipDocs?: boolean;
  skipReview?: boolean;
  reviewLevel?: string;
}

/**
 * Task command entry point — run specific tasks from a plan.
 */
export async function runTask(
  planName: string,
  taskNumbers: number[],
  opts: RunTaskOptions = {},
): Promise<void> {
  const projectRoot = resolveProjectRoot();

  // ── Resolve plan file ──

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

  const logPath = initLogger("task", planRelative);
  logDetail(`Logs: ${logPath}`);

  const hooks = await discoverHooks(projectRoot);
  validateMandatoryHooks(hooks);

  let settings = readSettings(projectRoot);
  if (typeof opts.parallel === "number") {
    settings = { ...settings, maxParallel: Math.max(1, Math.min(16, opts.parallel)) };
  }
  if (typeof opts.maxFailures === "number") {
    settings = { ...settings, maxFailures: Math.max(1, Math.min(100, opts.maxFailures)) };
  }

  enableTaskPrefix(settings.maxParallel > 1);

  // ── Pre-flight validation ──

  const diskData = readPlan(planFile);
  const requestedIds = expandTaskNumbers(taskNumbers);

  // Validate all task IDs exist in the plan.
  const missing = requestedIds.filter((id) => !findTask(diskData, id));
  if (missing.length > 0) {
    process.stderr.write(`Error: task(s) not found in plan: ${missing.join(", ")}\n`);
    process.exit(1);
  }

  // Dependency check.
  let allowedTaskIds: Set<string>;

  if (opts.buildDeps) {
    // Expand to include all unimplemented transitive dependencies.
    allowedTaskIds = resolveTransitiveDeps(diskData, requestedIds);
    const extraDeps = [...allowedTaskIds].filter((id) => !requestedIds.includes(id));
    if (extraDeps.length > 0) {
      log(`--build-deps: will also build ${extraDeps.length} dependency task(s): ${extraDeps.join(", ")}`);
    }
  } else {
    // Abort if any dependency is not implemented.
    const unmetDeps: string[] = [];
    for (const id of requestedIds) {
      const task = findTask(diskData, id)!;
      for (const depId of task.depends_on ?? []) {
        const dep = findTask(diskData, depId);
        if (dep && dep.status !== "implemented") {
          unmetDeps.push(`${id} depends on ${depId} (status: ${dep.status})`);
        }
      }
    }
    if (unmetDeps.length > 0) {
      process.stderr.write(
        `Error: unmet dependencies — cannot proceed without --build-deps:\n  ${unmetDeps.join("\n  ")}\n`,
      );
      process.exit(1);
    }
    allowedTaskIds = new Set(requestedIds);
  }

  // ── Run (mirrors runAllTasksMode from build) ──

  log(`Starting task run: ${requestedIds.join(", ")} from ${planRelative}`);
  log(`Parallelism: ${settings.maxParallel} worker(s), max failures: ${settings.maxFailures ?? "no limit"}`);

  const baseBranch = diskData.base_branch || "main";

  const syncOutcome = await checkBaseSync(
    projectRoot,
    settings.remote,
    baseBranch,
    planRelativePath(projectRoot, planFile),
    (question) => promptYesNo(question, { syncAnswer: opts.syncAnswer }),
  );
  if (!syncOutcome.ok) {
    log(`TASK RUN ABORTED: ${syncOutcome.message}`);
    process.exit(1);
  }
  if (syncOutcome.action !== "in-sync") {
    log(`Base sync: ${syncOutcome.action}`);
  }

  // Reset failed tasks — only within the allowed set (unless resuming).
  const freshData = readPlan(planFile);
  if (!opts.resume) {
    for (const t of freshData.tasks) {
      if (allowedTaskIds.has(t.id) && t.status === "failed") {
        t.status = "pending";
        t.errors = [];
        delete t.stage;
      }
      if (allowedTaskIds.has(t.id) && t.sub_tasks) {
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

  const planState = new PlanState(freshData, allowedTaskIds);

  const resumeTaskIds = new Set<string>();
  if (opts.resume) {
    for (const t of freshData.tasks) {
      if (allowedTaskIds.has(t.id) && t.status === "in_progress") {
        resumeTaskIds.add(t.id);
      }
    }
  }

  planState.setPlanStatus("in_progress");

  // Start hook (optional).
  const startResult = await tryHook(
    hooks,
    "start",
    { build: buildBuildContext(planFile, planRelative, "start") },
    { timeout: settings.hookTimeout },
  );
  if (startResult && !startResult.ok) {
    log(`TASK RUN ABORTED: start hook failed — ${startResult.stderr}`);
    planState.setPlanStatus("failed");
    flushPlanToDisk(planFile, planState);
    process.exit(1);
  }

  // Pre-scheduler healthcheck.
  const healthAfterStart = await runHealthcheckHook(hooks, {
    planFile,
    planName: planRelative,
    stage: "start",
    settings,
    cwd: projectRoot,
  });
  if (!healthAfterStart.ok) {
    await fireHalt(hooks, planFile, planRelative, healthAfterStart.issues, settings);
    flushPlanToDisk(planFile, planState);
    process.exit(1);
  }

  const totalTaskCount = freshData.tasks.length;

  const schedulerResult = await runScheduler({
    hooks,
    projectRoot,
    planFile,
    planName: planRelative,
    settings,
    planState,
    resume: opts.resume ?? false,
    resumeTaskIds,
    skipDocs: opts.skipDocs ?? false,
    skipReview: opts.skipReview ?? false,
    reviewLevels: parseReviewLevels(opts.reviewLevel),
  });

  const { doneCount, failedCount, drainedEarly, blockedTaskIds } = schedulerResult;

  if (drainedEarly || blockedTaskIds.length > 0) {
    const snap = planState.snapshot();
    const failedIds = snap.tasks.filter((t) => t.status === "failed").map((t) => t.id);
    const issues = drainedEarly
      ? [`Max failures reached — ${failedIds.length} task(s) failed: ${failedIds.join(", ")}`]
      : [`Deadlock — ${blockedTaskIds.length} task(s) blocked by failed deps: ${blockedTaskIds.join(", ")}`];
    await fireHalt(hooks, planFile, planRelative, issues, settings);
  }

  // PRD status update only when ALL plan tasks are done (not just the subset).
  const allDone = freshData.tasks.every(
    (t) => t.status === "implemented" || planState.snapshot().tasks.find((s) => s.id === t.id)?.status === "implemented",
  );
  if (failedCount === 0 && allDone) {
    flushPlanToDisk(planFile, planState);
    updatePrdStatuses(projectRoot, planFile);
  }

  // Stop hook (optional).
  const stopStage: BuildStage = failedCount > 0 ? "failed" : "stop";
  await tryHook(
    hooks,
    "stop",
    { build: buildBuildContext(planFile, planRelative, stopStage) },
    { timeout: settings.hookTimeout },
  );

  // Final plan flush — use total plan task count for plan-level status.
  const totalDone = planState.snapshot().tasks.filter((t) => t.status === "implemented").length;
  const totalFailed = planState.snapshot().tasks.filter((t) => t.status === "failed").length;
  flushPlanLevelStatus(planFile, planState, totalTaskCount, totalDone, totalFailed);

  // ── Completion report (scoped to requested tasks + deps) ──

  {
    const h = buildEndHeading();
    log(h.title);
    logDetail(h.rule);
  }
  logDetail(
    statsLine([
      ["Implemented", String(doneCount)],
      ["Failed", String(failedCount)],
      ["Scope", `${allowedTaskIds.size} task(s)`],
    ]),
  );
  if (drainedEarly) {
    logDetail(`Task run drained early after reaching max failures.`);
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
    if (!allowedTaskIds.has(task.id)) continue;
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
