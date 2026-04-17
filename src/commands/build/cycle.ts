import { MAX_DEV_CYCLES } from "../../lib/config.js";
import { phaseSep } from "../../lib/format.js";
import { rebaseOnRemoteBase } from "../../lib/git.js";
import { isSubTaskId, log, logDetail, parentTaskId } from "../../lib/utils.js";
import type {
  BuildContext,
  BuildStage,
  DevTestReviewResult,
  HookMap,
  PlanData,
  Settings,
  TaskContext,
} from "../../types.js";
import { findTask, readPlan, updateSubTaskStage, updateTaskStage } from "./plan-data.js";
import { writeReport } from "./reports.js";
import { maybePushAfterCommit, runDevSession, runReviewSession, runVerifyHook } from "./sessions.js";

/**
 * Build a task context object from plan data for passing to hooks.
 */
export function buildTaskContext(data: PlanData, taskId: string): TaskContext {
  const isSub = isSubTaskId(taskId);
  const task = isSub ? findTask(data, parentTaskId(taskId)) : findTask(data, taskId);
  if (!task) return {};

  const ctx: TaskContext = {};
  if (task.feature) ctx.feature_id = task.feature;
  if (task.use_case) ctx.usecase_id = task.use_case;
  if (task.scenario) ctx.scenario_id = task.scenario;
  return ctx;
}

/**
 * Build a BuildContext object from plan data for passing to hooks.
 */
export function buildBuildContext(planFile: string, planName: string, stage: BuildStage): BuildContext {
  const data = readPlan(planFile);

  const completedTasks: string[] = [];
  const completedScenarios: string[] = [];
  const ucTaskCounts = new Map<string, { total: number; done: number }>();
  const featTaskCounts = new Map<string, { total: number; done: number }>();

  for (const task of data.tasks) {
    // Track UC/feature completion counts
    if (task.use_case) {
      const entry = ucTaskCounts.get(task.use_case) || { total: 0, done: 0 };
      entry.total++;
      if (task.status === "implemented") entry.done++;
      ucTaskCounts.set(task.use_case, entry);
    }
    if (task.feature) {
      const entry = featTaskCounts.get(task.feature) || { total: 0, done: 0 };
      entry.total++;
      if (task.status === "implemented") entry.done++;
      featTaskCounts.set(task.feature, entry);
    }

    if (task.status === "implemented") {
      completedTasks.push(task.id);
      if (task.scenario) completedScenarios.push(task.scenario);
    }
  }

  const completedUseCases: string[] = [];
  for (const [uc, counts] of ucTaskCounts) {
    if (counts.total > 0 && counts.done === counts.total) completedUseCases.push(uc);
  }

  const completedFeatures: string[] = [];
  for (const [feat, counts] of featTaskCounts) {
    if (counts.total > 0 && counts.done === counts.total) completedFeatures.push(feat);
  }

  return {
    plan_path: planFile,
    plan_name: planName,
    plan_status: data.status,
    base_branch: data.base_branch || "main",
    scope: data.scope || [],
    stage,
    completed: {
      tasks: completedTasks,
      scenarios: completedScenarios,
      use_cases: completedUseCases,
      features: completedFeatures,
    },
  };
}

/**
 * Core dev → test → completeness cycle.
 *
 * 1. Dev session (Opus) — writes code + commits
 * 2. Test hook (mandatory) — developer-defined programmatic checks
 * 3. If test fails → loop back to dev with issues
 * 4. Completeness check (Sonnet) — AI completeness gate only
 * 5. If completeness has issues → loop back to dev with issues
 * 6. If completeness passes → done
 *
 * Code review is deferred to boundary level (UC/feature/plan) by the scheduler.
 * Retries up to MAX_DEV_CYCLES times.
 */
export async function runDevTestReviewCycle(
  hooks: HookMap,
  projectRoot: string,
  planFile: string,
  taskId: string,
  priorSummaries: string[],
  planDir: string | null,
  scope: "task" | "subtask",
  settings: Settings,
  planName: string,
  baseBranch: string,
  cwd?: string,
  branch?: string,
): Promise<DevTestReviewResult> {
  let issues: string[] = [];

  for (let cycle = 1; cycle <= MAX_DEV_CYCLES; cycle++) {
    log(`Dev-test-review cycle ${cycle}/${MAX_DEV_CYCLES} for ${taskId}`);
    logDetail(phaseSep());

    // Mark DEV stage before the dev session. Dev commits, so this plan-change
    // gets flushed to git. VERIFY/REVIEW that follow don't commit, so we leave
    // the stage at DEV through the full cycle.
    if (isSubTaskId(taskId)) {
      updateSubTaskStage(planFile, taskId, "DEV");
    } else {
      updateTaskStage(planFile, taskId, "DEV");
    }

    // Rebase the task branch onto the freshest remote base before every
    // write stage so we pick up any concurrent merges.
    if (cwd) {
      const rebased = await rebaseOnRemoteBase(cwd, settings.remote, baseBranch, `pre-dev-${taskId}-${cycle}`);
      if (!rebased.ok) {
        return {
          ok: false,
          devResult: null,
          reviewResult: null,
          error: `Pre-dev rebase failed: ${rebased.error}`,
        };
      }
    }

    // 1. Dev session — writes code + commits
    const dev = await runDevSession(projectRoot, planFile, taskId, priorSummaries, issues, planName, cwd);
    if (!dev.ok) {
      return {
        ok: false,
        devResult: dev.structured,
        reviewResult: null,
        error: dev.structured?.error || "Dev session failed",
      };
    }

    await maybePushAfterCommit(settings, `dev ${taskId}`, cwd);
    logDetail(phaseSep());

    const filesModified = dev.structured.files_modified || [];

    // 2. Test hook — mandatory programmatic checks
    const test = await runVerifyHook(hooks, {
      taskId,
      planFile,
      filesModified,
      scope,
      settings,
      planName,
      stage: "development",
      cwd,
      branch,
    });

    if (planDir) {
      writeReport(planDir, `${taskId}-test-${cycle}`, { issues: test.issues });
    }

    if (!test.ok) {
      issues = test.issues;
      logDetail(
        `Cycle ${cycle} test failed with ${issues.length} issues — ${cycle < MAX_DEV_CYCLES ? "retrying" : "exhausted"}`,
      );
      continue;
    }

    logDetail(phaseSep());

    // 3. Completeness check — code review is deferred to boundary (UC/feature/plan)
    const review = await runReviewSession(hooks, projectRoot, planFile, taskId, settings, planName, "completeness", cwd, branch);

    if (planDir) {
      writeReport(planDir, `${taskId}-review-${cycle}`, review.structured);
    }

    if (!review.ok) {
      issues = review.issues;
      logDetail(
        `Cycle ${cycle} review found ${issues.length} issues — ${cycle < MAX_DEV_CYCLES ? "retrying" : "exhausted"}`,
      );
      continue;
    }

    // All clear — success
    return {
      ok: true,
      devResult: dev.structured,
      reviewResult: review.structured,
    };
  }

  return {
    ok: false,
    devResult: null,
    reviewResult: null,
    error: `Dev-test-review cycle exhausted after ${MAX_DEV_CYCLES} attempts. Last issues: ${issues.slice(0, 5).join("; ")}`,
  };
}

/**
 * Task-level validation after all sub-tasks are complete.
 *
 * Runs test → review without an initial dev session (the code is already
 * written by sub-tasks). If test or review fails, launches a dev fix
 * session and retries up to MAX_DEV_CYCLES times.
 */
export async function runTaskLevelValidation(
  hooks: HookMap,
  projectRoot: string,
  planFile: string,
  taskId: string,
  priorSummaries: string[],
  planDir: string | null,
  settings: Settings,
  planName: string,
  baseBranch: string,
  cwd?: string,
  branch?: string,
): Promise<DevTestReviewResult> {
  // First pass: test + review only (no dev session needed)
  log(`Task-level validation for ${taskId} (test + review)`);
  logDetail(phaseSep());

  const test = await runVerifyHook(hooks, {
    taskId,
    planFile,
    filesModified: [],
    scope: "task",
    settings,
    planName,
    stage: "validation",
    cwd,
    branch,
  });
  if (planDir) {
    writeReport(planDir, `${taskId}-task-test-1`, { issues: test.issues });
  }

  if (test.ok) {
    const review = await runReviewSession(hooks, projectRoot, planFile, taskId, settings, planName, "completeness", cwd, branch);
    if (planDir) {
      writeReport(planDir, `${taskId}-task-review-1`, review.structured);
    }

    if (review.ok) {
      return { ok: true, devResult: null, reviewResult: review.structured };
    }

    // Review failed — need a dev fix
    logDetail(`Task-level review found ${review.issues.length} issues — launching fix cycle`);
    return runDevTestReviewCycle(
      hooks,
      projectRoot,
      planFile,
      taskId,
      priorSummaries,
      planDir,
      "task",
      settings,
      planName,
      baseBranch,
      cwd,
      branch,
    );
  }

  // Test failed — need a dev fix
  logDetail(`Task-level test failed with ${test.issues.length} issues — launching fix cycle`);

  // Feed test issues directly into a dev-test-review cycle
  let issues = test.issues;

  for (let cycle = 1; cycle <= MAX_DEV_CYCLES; cycle++) {
    log(`Task-level fix cycle ${cycle}/${MAX_DEV_CYCLES} for ${taskId}`);

    // Task-level fix cycle always operates on the parent task (never a sub-task).
    updateTaskStage(planFile, taskId, "DEV");

    // Rebase on freshest remote base before every write stage.
    if (cwd) {
      const rebased = await rebaseOnRemoteBase(cwd, settings.remote, baseBranch, `pre-fix-${taskId}-${cycle}`);
      if (!rebased.ok) {
        return {
          ok: false,
          devResult: null,
          reviewResult: null,
          error: `Pre-dev rebase failed: ${rebased.error}`,
        };
      }
    }

    const dev = await runDevSession(projectRoot, planFile, taskId, priorSummaries, issues, planName, cwd);
    if (!dev.ok) {
      return {
        ok: false,
        devResult: dev.structured,
        reviewResult: null,
        error: dev.structured?.error || "Dev session failed",
      };
    }

    await maybePushAfterCommit(settings, `dev ${taskId}`, cwd);

    const filesModified = dev.structured.files_modified || [];

    const reTest = await runVerifyHook(hooks, {
      taskId,
      planFile,
      filesModified,
      scope: "task",
      settings,
      planName,
      stage: "validation",
      cwd,
      branch,
    });
    if (planDir) {
      writeReport(planDir, `${taskId}-task-test-${cycle + 1}`, { issues: reTest.issues });
    }

    if (!reTest.ok) {
      issues = reTest.issues;
      logDetail(
        `Fix cycle ${cycle} test failed with ${issues.length} issues — ${cycle < MAX_DEV_CYCLES ? "retrying" : "exhausted"}`,
      );
      continue;
    }

    const review = await runReviewSession(hooks, projectRoot, planFile, taskId, settings, planName, "completeness", cwd, branch);
    if (planDir) {
      writeReport(planDir, `${taskId}-task-review-${cycle + 1}`, review.structured);
    }

    if (!review.ok) {
      issues = review.issues;
      logDetail(
        `Fix cycle ${cycle} review found ${issues.length} issues — ${cycle < MAX_DEV_CYCLES ? "retrying" : "exhausted"}`,
      );
      continue;
    }

    return { ok: true, devResult: dev.structured, reviewResult: review.structured };
  }

  return {
    ok: false,
    devResult: null,
    reviewResult: null,
    error: `Task-level fix cycle exhausted after ${MAX_DEV_CYCLES} attempts. Last issues: ${issues.slice(0, 5).join("; ")}`,
  };
}
