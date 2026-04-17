import { issuesBlock, phaseLabel } from "../../lib/format.js";
import { log, logDetail } from "../../lib/utils.js";
import type { DoneItems, HookMap, PlanData, ReviewLevel, ReviewMode, Settings } from "../../types.js";
import { runReviewSession } from "./sessions.js";

/**
 * Map from review level to the review mode used at that level.
 * Higher levels get more thorough reviews.
 */
const LEVEL_MODE: Record<ReviewLevel, ReviewMode> = {
  scenario: "completeness",
  usecase: "review",
  feature: "full",
  plan: "full",
};

/** Priority order — higher index = higher level. */
const LEVEL_PRIORITY: ReviewLevel[] = ["scenario", "usecase", "feature", "plan"];

/**
 * Determine the highest review level that should fire, given what completed
 * and what --review-level is configured. Returns the mode to use, or null
 * if no review should fire.
 *
 * Smart dedup: only the highest matching level fires. If a task completes
 * a scenario, UC, and feature, and --review-level is "usecase,feature",
 * only the feature-level review fires.
 */
export function resolveReviewAction(
  doneItems: DoneItems,
  reviewLevels: Set<ReviewLevel>,
): { level: ReviewLevel; mode: ReviewMode; boundaryId: string } | null {
  // Walk from highest to lowest priority — first match wins
  for (let i = LEVEL_PRIORITY.length - 1; i >= 0; i--) {
    const level = LEVEL_PRIORITY[i];
    if (!reviewLevels.has(level)) continue;

    let boundaryId: string | undefined;
    switch (level) {
      case "plan":
        if (doneItems.plan_complete) boundaryId = "plan";
        break;
      case "feature":
        if (doneItems.feature) boundaryId = doneItems.feature;
        break;
      case "usecase":
        if (doneItems.usecase) boundaryId = doneItems.usecase;
        break;
      case "scenario":
        if (doneItems.scenario) boundaryId = doneItems.scenario;
        break;
    }

    if (boundaryId) {
      return { level, mode: LEVEL_MODE[level], boundaryId };
    }
  }

  return null;
}

/**
 * Collect task IDs that belong to the boundary being reviewed.
 */
export function taskIdsForBoundary(
  data: PlanData,
  level: ReviewLevel,
  boundaryId: string,
): string[] {
  switch (level) {
    case "scenario":
      return data.tasks.filter((t) => t.scenario === boundaryId).map((t) => t.id);
    case "usecase":
      return data.tasks.filter((t) => t.use_case === boundaryId).map((t) => t.id);
    case "feature":
      return data.tasks.filter((t) => t.feature === boundaryId).map((t) => t.id);
    case "plan":
      return data.tasks.map((t) => t.id);
  }
}

export interface BoundaryReviewResult {
  level: ReviewLevel;
  boundaryId: string;
  issues: string[];
}

/**
 * Run boundary review for a set of task IDs at the resolved mode.
 * Runs on projectRoot (base branch — all tasks already merged).
 * Issues are logged as warnings (v1: no retry/fix loop).
 */
export async function runBoundaryReview(
  hooks: HookMap,
  projectRoot: string,
  planFile: string,
  taskIds: string[],
  level: ReviewLevel,
  boundaryId: string,
  mode: ReviewMode,
  settings: Settings,
  planName: string,
): Promise<BoundaryReviewResult> {
  log(`${phaseLabel("REVIEW")} boundary: ${level} ${boundaryId} (mode: ${mode}, ${taskIds.length} task(s))`);

  const allIssues: string[] = [];

  for (const taskId of taskIds) {
    const result = await runReviewSession(
      hooks,
      projectRoot,
      planFile,
      taskId,
      settings,
      planName,
      mode,
    );

    if (!result.ok) {
      allIssues.push(...result.issues);
    }
  }

  if (allIssues.length > 0) {
    log(`${phaseLabel("REVIEW")} boundary ${level} ${boundaryId}: ${allIssues.length} issue(s) (warnings only)`);
    logDetail(issuesBlock(allIssues));
  } else {
    log(`${phaseLabel("REVIEW")} boundary ${level} ${boundaryId}: all clear`);
  }

  return { level, boundaryId, issues: allIssues };
}
