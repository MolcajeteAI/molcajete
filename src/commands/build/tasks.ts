import type { HookMap, Task, Settings } from "../../types.js";
import { log } from "../../lib/utils.js";
import { readPlan, findTask, updateSubTaskStatus, checkSubTaskDeps } from "./plan-data.js";
import { tryHook } from "../lib/hooks.js";
import { buildTaskContext, buildBuildContext, runDevTestReviewCycle, runTaskLevelValidation } from "./cycle.js";

/**
 * Run a simple task (no sub-tasks): dev → test → review cycle.
 */
export async function runSimpleTask(
  hooks: HookMap,
  projectRoot: string,
  planFile: string,
  task: Task,
  priorSummaries: string[],
  planDir: string | null,
  settings: Settings,
  planName?: string,
  cwd?: string,
  branch?: string,
): Promise<{ ok: boolean; error?: string; devResult?: unknown }> {
  const taskId = task.id;

  const data = readPlan(planFile);
  const taskContext = buildTaskContext(data, taskId);

  // Lifecycle hook: before-task
  await tryHook(
    hooks,
    "before-task",
    {
      task_id: taskId,
      intent: task.intent,
      ...taskContext,
      ...(cwd && { cwd }),
      ...(branch && { branch }),
      ...(planName && { build: buildBuildContext(planFile, planName, "before-task") }),
    },
    { timeout: settings.hookTimeout },
  );

  const result = await runDevTestReviewCycle(
    hooks,
    projectRoot,
    planFile,
    taskId,
    priorSummaries,
    planDir,
    "task",
    settings,
    planName,
    cwd,
    branch,
  );

  if (!result.ok) {
    await tryHook(
      hooks,
      "after-task",
      {
        task_id: taskId,
        status: "failed",
        summary: result.error || "",
        ...taskContext,
        ...(cwd && { cwd }),
        ...(branch && { branch }),
        ...(planName && { build: buildBuildContext(planFile, planName, "after-task") }),
      },
      { timeout: settings.hookTimeout },
    );
    return { ok: false, error: result.error, devResult: result.devResult };
  }

  await tryHook(
    hooks,
    "after-task",
    {
      task_id: taskId,
      status: "implemented",
      summary: result.devResult?.summary || "",
      ...taskContext,
      ...(cwd && { cwd }),
      ...(branch && { branch }),
      ...(planName && { build: buildBuildContext(planFile, planName, "after-task") }),
    },
    { timeout: settings.hookTimeout },
  );

  return { ok: true, devResult: result.devResult };
}

/**
 * Run a task with sub-tasks: iterate sub-tasks, then task-level test + review.
 */
export async function runTaskWithSubTasks(
  hooks: HookMap,
  projectRoot: string,
  planFile: string,
  task: Task,
  priorSummaries: string[],
  planDir: string | null,
  settings: Settings,
  planName?: string,
  cwd?: string,
  branch?: string,
): Promise<{ ok: boolean; error?: string }> {
  const taskId = task.id;
  const subTasks = task.sub_tasks ?? [];
  const subSummaries = [...priorSummaries];

  const data = readPlan(planFile);
  const taskContext = buildTaskContext(data, taskId);

  // Lifecycle hook: before-task
  await tryHook(
    hooks,
    "before-task",
    {
      task_id: taskId,
      intent: task.intent,
      ...taskContext,
      ...(cwd && { cwd }),
      ...(branch && { branch }),
      ...(planName && { build: buildBuildContext(planFile, planName, "before-task") }),
    },
    { timeout: settings.hookTimeout },
  );

  // Run each sub-task sequentially
  for (const st of subTasks) {
    const stId = st.id;

    const freshData = readPlan(planFile);
    const freshTask = findTask(freshData, taskId);
    if (!freshTask) continue;
    const depResult = checkSubTaskDeps(freshTask, stId);

    if (depResult === 1) {
      log(`Sub-task ${stId}: dependency failed — skipping`);
      updateSubTaskStatus(planFile, stId, "failed", { error: "Dependency failed" });
      return { ok: false, error: `Sub-task ${stId} dependency failed` };
    }

    if (depResult === 2) {
      log(`Sub-task ${stId}: dependency not yet done — skipping`);
      continue;
    }

    if (st.status === "implemented") {
      if (st.summary) subSummaries.push(st.summary);
      continue;
    }

    log(`── Sub-task: ${stId} — ${st.title} ──`);

    await tryHook(
      hooks,
      "before-subtask",
      {
        task_id: taskId,
        subtask_id: stId,
        ...taskContext,
        ...(cwd && { cwd }),
        ...(branch && { branch }),
        ...(planName && { build: buildBuildContext(planFile, planName, "before-task") }),
      },
      { timeout: settings.hookTimeout },
    );

    updateSubTaskStatus(planFile, stId, "in_progress");

    const result = await runDevTestReviewCycle(
      hooks,
      projectRoot,
      planFile,
      stId,
      subSummaries,
      planDir,
      "subtask",
      settings,
      planName,
      cwd,
      branch,
    );

    if (!result.ok) {
      updateSubTaskStatus(planFile, stId, "failed", { errors: [result.error] });

      await tryHook(
        hooks,
        "after-subtask",
        {
          task_id: taskId,
          subtask_id: stId,
          status: "failed",
          ...taskContext,
          ...(cwd && { cwd }),
          ...(branch && { branch }),
          ...(planName && { build: buildBuildContext(planFile, planName, "before-task") }),
        },
        { timeout: settings.hookTimeout },
      );

      return { ok: false, error: `Sub-task ${stId} failed: ${result.error}` };
    }

    updateSubTaskStatus(planFile, stId, "implemented", {
      summary: result.devResult?.summary || null,
    });

    if (result.devResult?.summary) subSummaries.push(result.devResult.summary);
    log(`Sub-task ${stId}: implemented`);

    await tryHook(
      hooks,
      "after-subtask",
      {
        task_id: taskId,
        subtask_id: stId,
        status: "implemented",
        ...taskContext,
        ...(cwd && { cwd }),
        ...(branch && { branch }),
        ...(planName && { build: buildBuildContext(planFile, planName, "before-task") }),
      },
      { timeout: settings.hookTimeout },
    );
  }

  // Task-level validation — test + review only (code already written by sub-tasks)
  // If test or review fails, a dev fix session is launched automatically
  const taskResult = await runTaskLevelValidation(
    hooks,
    projectRoot,
    planFile,
    taskId,
    subSummaries,
    planDir,
    settings,
    planName,
    cwd,
    branch,
  );

  if (!taskResult.ok) {
    await tryHook(
      hooks,
      "after-task",
      {
        task_id: taskId,
        status: "failed",
        summary: taskResult.error || "",
        ...taskContext,
        ...(cwd && { cwd }),
        ...(branch && { branch }),
        ...(planName && { build: buildBuildContext(planFile, planName, "after-task") }),
      },
      { timeout: settings.hookTimeout },
    );
    return { ok: false, error: taskResult.error };
  }

  await tryHook(
    hooks,
    "after-task",
    {
      task_id: taskId,
      status: "implemented",
      summary: "",
      ...taskContext,
      ...(cwd && { cwd }),
      ...(branch && { branch }),
      ...(planName && { build: buildBuildContext(planFile, planName, "after-task") }),
    },
    { timeout: settings.hookTimeout },
  );

  return { ok: true };
}
