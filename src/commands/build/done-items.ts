import { log } from "../../lib/utils.js";
import type { BuildContext, DoneItems, HookMap, PlanData, Settings } from "../../types.js";
import { tryHook } from "../lib/hooks.js";
import { buildBuildContext } from "./cycle.js";

/**
 * Compute what just completed after a task finishes. Each field is independently
 * computed — a task might complete a scenario without completing the UC.
 */
export function getDoneItems(data: PlanData, justCompletedTaskId: string): DoneItems {
  const task = data.tasks.find((t) => t.id === justCompletedTaskId);
  if (!task) return { task: justCompletedTaskId };

  const result: DoneItems = { task: justCompletedTaskId };

  // Scenario: all tasks with this scenario are implemented
  if (task.scenario) {
    const scenarioTasks = data.tasks.filter((t) => t.scenario === task.scenario);
    if (scenarioTasks.every((t) => t.status === "implemented")) {
      result.scenario = task.scenario;
    }
  }

  // Use case: all tasks with this UC are implemented
  if (task.use_case) {
    const ucTasks = data.tasks.filter((t) => t.use_case === task.use_case);
    if (ucTasks.every((t) => t.status === "implemented")) {
      result.usecase = task.use_case;
    }
  }

  // Feature: all tasks with this feature are implemented
  if (task.feature) {
    const featTasks = data.tasks.filter((t) => t.feature === task.feature);
    if (featTasks.every((t) => t.status === "implemented")) {
      result.feature = task.feature;
    }
  }

  // Plan: all tasks implemented
  if (data.tasks.every((t) => t.status === "implemented")) {
    result.plan_complete = true;
  }

  return result;
}

/**
 * Fire lifecycle hooks for each completed level, all in parallel.
 * Each hook receives the full DoneItems context so developers can decide
 * whether to act (e.g. skip usecase-complete if feature is also set).
 */
export async function triggerDoneHooks(
  hooks: HookMap,
  doneItems: DoneItems,
  planFile: string,
  planName: string,
  settings: Settings,
): Promise<void> {
  const build: BuildContext = buildBuildContext(planFile, planName, "done");
  const payload = { ...doneItems, build };
  const promises: Promise<unknown>[] = [];

  if (doneItems.scenario) {
    log(`Scenario complete: ${doneItems.scenario}`);
    promises.push(tryHook(hooks, "scenario-complete", payload, { timeout: settings.hookTimeout }));
  }
  if (doneItems.usecase) {
    log(`Use case complete: ${doneItems.usecase}`);
    promises.push(tryHook(hooks, "usecase-complete", payload, { timeout: settings.hookTimeout }));
  }
  if (doneItems.feature) {
    log(`Feature complete: ${doneItems.feature}`);
    promises.push(tryHook(hooks, "feature-complete", payload, { timeout: settings.hookTimeout }));
  }
  if (doneItems.plan_complete) {
    log("Plan complete: all tasks implemented");
    promises.push(tryHook(hooks, "plan-complete", payload, { timeout: settings.hookTimeout }));
  }

  await Promise.all(promises);
}
