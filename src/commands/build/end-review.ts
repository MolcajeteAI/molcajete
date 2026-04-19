import { execSync } from "node:child_process";
import { MAX_DEV_CYCLES } from "../../lib/config.js";
import { issuesBlock, phaseLabel } from "../../lib/format.js";
import { log, logDetail } from "../../lib/utils.js";
import type { HookMap, Settings } from "../../types.js";
import { runHook } from "../lib/hooks.js";
import { readPlan, findTask } from "./plan-data.js";
import { runReviewFixSession, runReviewSession } from "./sessions.js";
import { buildBuildContext } from "./cycle.js";

export interface EndOfBuildReviewOptions {
  hooks: HookMap;
  projectRoot: string;
  planFile: string;
  planName: string;
  settings: Settings;
  taskIds: string[];
  seedSessionName?: string;
}

export interface EndOfBuildReviewResult {
  ok: boolean;
  issues: string[];
}

/**
 * End-of-build review: single code review pass, then fix + completeness/test
 * loop if issues are found.
 *
 * - Code review: one shot (never re-runs)
 * - Fix session: spawned once after code review, then again for each
 *   completeness/test failure
 * - Completeness + test: loops up to MAX_DEV_CYCLES until clean or exhausted
 */
export async function runEndOfBuildReview(
  opts: EndOfBuildReviewOptions,
): Promise<EndOfBuildReviewResult> {
  const { hooks, projectRoot, planFile, planName, settings, taskIds, seedSessionName } = opts;

  log(`${phaseLabel("REVIEW")} end-of-build: ${taskIds.length} task(s) (mode: review)`);

  // ── Step 1: Code review (one shot) ──

  const review = await runReviewSession(
    hooks,
    projectRoot,
    planFile,
    taskIds[0],
    settings,
    planName,
    "review",
    undefined,
    undefined,
    taskIds,
    seedSessionName,
  );

  if (review.ok) {
    log(`${phaseLabel("REVIEW")} end-of-build: all clear`);
    return { ok: true, issues: [] };
  }

  const reviewIssues = review.issues;
  log(`${phaseLabel("REVIEW")} end-of-build: ${reviewIssues.length} issue(s) found — launching fix session`);
  logDetail(issuesBlock(reviewIssues));

  // ── Step 2: Fix session for code review issues (one shot) ──

  const fix = await runReviewFixSession(
    projectRoot,
    planFile,
    reviewIssues,
    taskIds,
    planName,
    undefined,
    seedSessionName,
  );

  if (!fix.ok) {
    log(`${phaseLabel("REVIEW")} end-of-build: fix session failed`);
    return { ok: false, issues: reviewIssues };
  }

  const fixSummary = fix.structured.summary || "";

  // ── Step 3: Completeness + test loop (up to MAX_DEV_CYCLES) ──

  let lastIssues = reviewIssues;

  for (let cycle = 1; cycle <= MAX_DEV_CYCLES; cycle++) {
    log(`${phaseLabel("REVIEW")} end-of-build: completeness + test cycle ${cycle}/${MAX_DEV_CYCLES}`);

    // Completeness check — pass original review issues + fix summary as context
    const completeness = await runReviewSession(
      hooks,
      projectRoot,
      planFile,
      taskIds[0],
      settings,
      planName,
      "completeness",
      undefined,
      undefined,
      taskIds,
      seedSessionName,
    );

    if (!completeness.ok) {
      lastIssues = completeness.issues;
      log(`${phaseLabel("REVIEW")} end-of-build: completeness found ${lastIssues.length} issue(s)`);
      logDetail(issuesBlock(lastIssues));

      if (cycle < MAX_DEV_CYCLES) {
        const reFix = await runReviewFixSession(
          projectRoot,
          planFile,
          lastIssues,
          taskIds,
          planName,
          undefined,
          seedSessionName,
        );
        if (!reFix.ok) {
          log(`${phaseLabel("REVIEW")} end-of-build: fix session failed on cycle ${cycle}`);
          return { ok: false, issues: lastIssues };
        }
      }
      continue;
    }

    // Run tests for all completed scenarios in scope
    const testResult = await runEndOfBuildVerify(hooks, planFile, taskIds, settings, planName);

    if (!testResult.ok) {
      lastIssues = testResult.issues;
      log(`${phaseLabel("REVIEW")} end-of-build: tests found ${lastIssues.length} issue(s)`);
      logDetail(issuesBlock(lastIssues));

      if (cycle < MAX_DEV_CYCLES) {
        const reFix = await runReviewFixSession(
          projectRoot,
          planFile,
          lastIssues,
          taskIds,
          planName,
          undefined,
          seedSessionName,
        );
        if (!reFix.ok) {
          log(`${phaseLabel("REVIEW")} end-of-build: fix session failed on cycle ${cycle}`);
          return { ok: false, issues: lastIssues };
        }
      }
      continue;
    }

    // Both passed
    log(`${phaseLabel("REVIEW")} end-of-build: all clear after ${cycle} cycle(s)`);
    return { ok: true, issues: [] };
  }

  log(`${phaseLabel("REVIEW")} end-of-build: exhausted after ${MAX_DEV_CYCLES} cycles`);
  return { ok: false, issues: lastIssues };
}

/**
 * Run the verify hook for all completed scenarios in the task scope.
 * Uses scope "final" to signal this is the end-of-build verification.
 */
async function runEndOfBuildVerify(
  hooks: HookMap,
  planFile: string,
  taskIds: string[],
  settings: Settings,
  planName: string,
): Promise<{ ok: boolean; issues: string[] }> {
  const data = readPlan(planFile);

  // Collect all unique scenario tags from tasks in scope
  const scenarioTags = new Set<string>();
  for (const taskId of taskIds) {
    const task = findTask(data, taskId);
    if (task?.scenario) {
      scenarioTags.add(`@${task.scenario}`);
    }
  }

  log(`${phaseLabel("VERIFY")} end-of-build: ${scenarioTags.size} scenario(s)`);

  // Get the latest commit SHA
  let commit = "";
  try {
    commit = execSync("git rev-parse HEAD", { stdio: "pipe" }).toString().trim();
  } catch {
    // non-fatal
  }

  const input: Record<string, unknown> = {
    task_id: "end-of-build",
    commit,
    files: [],
    tags: [...scenarioTags],
    scope: "final",
    build: buildBuildContext(planFile, planName, "validation"),
  };

  const result = await runHook(hooks.verify, input, {
    timeout: settings.hookTimeout ?? 180000,
  });

  if (!result.ok) {
    return { ok: false, issues: [`Verify hook failed: ${result.stderr}`] };
  }

  const output = result.data as unknown as { status: string; issues?: string[] };

  if (output.status === "success") {
    log(`${phaseLabel("VERIFY")} end-of-build: passed`);
    return { ok: true, issues: [] };
  }

  const issues = output.issues || ["Verify hook reported failure"];
  return { ok: false, issues };
}
