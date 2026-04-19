import { execSync } from "node:child_process";
import {
  BUDGET_AGENT,
  BUDGET_RECOVERY,
  DEV_SESSION_SCHEMA,
  DOC_SESSION_SCHEMA,
  MAX_TURNS_AGENT,
  MODEL,
  RECOVERY_SESSION_SCHEMA,
  REVIEW_SESSION_SCHEMA,
} from "../../lib/config.js";
import { issuesBlock, phaseLabel } from "../../lib/format.js";
import { pushCurrentBranch } from "../../lib/git.js";
import { isSubTaskId, log, logDetail, parentTaskId, sessionLabel } from "../../lib/utils.js";
import type {
  BuildStage,
  DevSessionOutput,
  DocSessionOutput,
  HealthcheckHookOutput,
  HookMap,
  RecoveryContext,
  RecoverySessionOutput,
  ReviewMode,
  ReviewSessionOutput,
  Settings,
  Task,
  VerifyHookOutput,
} from "../../types.js";
import { extractFailureReason, extractStructuredOutput, invokeClaude } from "../lib/claude.js";
import { runHook, tryHook } from "../lib/hooks.js";
import { buildBuildContext } from "./cycle.js";
import { resolveTaskContext } from "./context.js";
import { findTask, readPlan } from "./plan-data.js";

// ── Remote Push ──

/**
 * Push the current branch to the configured remote after a commit.
 * On non-fast-forward: fetches, rebases (with conflict resolution), and retries.
 * Non-fatal: logs a warning on failure, skipped silently when disabled.
 */
export async function maybePushAfterCommit(settings: Settings, label: string, cwd?: string): Promise<void> {
  if (settings.push === false) return;
  const result = await pushCurrentBranch(settings.remote, cwd);
  if (result.ok) {
    logDetail(`Push ${label}: ok`);
  } else if (result.skipped) {
    logDetail(`Push ${label}: skipped — ${result.error}`);
  } else {
    logDetail(`Push ${label}: warning — ${result.error}`);
  }
}

// ── Dev Session ──

export async function runDevSession(
  projectRoot: string,
  planFile: string,
  taskId: string,
  priorSummaries: string[],
  issues: string[],
  planName: string,
  cwd?: string,
  seedSessionName?: string,
  priorFilesModified?: string[],
): Promise<{ ok: boolean; structured: DevSessionOutput }> {
  const _label = sessionLabel(planName, taskId, "dev");
  const isRetry = issues.length > 0;
  const retrySuffix = isRetry ? ` (retry, ${issues.length} issues)` : "";
  log(`${phaseLabel("DEV")} session: ${taskId}${retrySuffix}`);

  const planData = readPlan(planFile);
  const context = resolveTaskContext(planFile, planData, taskId, cwd);

  // Seed forking only works when running in projectRoot (same directory as
  // the seed session). Worktree sessions (cwd is set) have a different
  // project scope and can't find the seed session.
  const canFork = seedSessionName && !cwd;
  const forkArgs = canFork
    ? ["--resume", seedSessionName, "--fork-session"]
    : [];

  let payload: string;
  let command: string;

  if (isRetry && priorFilesModified) {
    // Retry: use fix.md with minimal payload — no full context reload
    payload = JSON.stringify({
      task: context.task,
      plan_section: context.plan_section,
      issues,
      files_modified: priorFilesModified,
    });
    command = `/molcajete:fix ${payload}`;
  } else {
    // First run: use develop.md with rich payload
    payload = JSON.stringify({
      task: context.task,
      plan_section: context.plan_section,
      gherkin: context.gherkin,
      steps_index: context.steps_index,
      feature_file_path: context.feature_file_path,
      uc_file_path: context.uc_file_path,
      architecture_path: context.architecture_path,
      prior_summaries: priorSummaries,
      issues,
      ...(canFork && { context_preloaded: true }),
    });
    command = `/molcajete:develop ${payload}`;
  }

  const result = await invokeClaude(
    cwd || projectRoot,
    [
      ...forkArgs,
      "--model",
      MODEL,
      "--allowedTools",
      "Read,Write,Edit,Glob,Grep,Bash",
      "--max-turns",
      MAX_TURNS_AGENT,
      "--max-budget-usd",
      BUDGET_AGENT,
      "--json-schema",
      JSON.stringify(DEV_SESSION_SCHEMA),
      command,
    ],
    "DEV",
  );

  const out = extractStructuredOutput(result.output) as unknown as DevSessionOutput;

  if (result.exitCode === 0 && out.status === "done") {
    return { ok: true, structured: out };
  }

  const error = out.error || extractFailureReason(result.output, result.stderr) || "Dev session failed";
  log(`${phaseLabel("DEV")} session ${taskId}: failed (${error})`);
  return { ok: false, structured: out };
}

// ── Verify Hook ──

export interface VerifyHookOptions {
  taskId: string;
  planFile: string;
  filesModified: string[];
  scope: "task" | "subtask" | "final";
  settings: Settings;
  planName?: string;
  stage?: BuildStage;
  cwd?: string;
  branch?: string;
}

export async function runVerifyHook(
  hooks: HookMap,
  opts: VerifyHookOptions,
): Promise<{ ok: boolean; issues: string[] }> {
  const { taskId, planFile, filesModified, scope, settings, planName, stage, cwd, branch } = opts;
  log(`${phaseLabel("VERIFY")} hook: ${taskId} (scope: ${scope})`);

  const data = readPlan(planFile);
  const isSub = isSubTaskId(taskId);
  const pId = isSub ? parentTaskId(taskId) : taskId;
  const task = findTask(data, pId);
  const scenarioTag = task?.scenario ? [`@${task.scenario}`] : [];

  // Get the latest commit SHA
  let commit = "";
  try {
    commit = execSync("git rev-parse HEAD", { stdio: "pipe", ...(cwd && { cwd }) })
      .toString()
      .trim();
  } catch {
    // non-fatal
  }

  const input: Record<string, unknown> = {
    task_id: taskId,
    commit,
    files: filesModified,
    tags: scenarioTag,
    scope,
  };

  if (cwd) input.cwd = cwd;
  if (branch) input.branch = branch;

  if (planName) {
    input.build = buildBuildContext(planFile, planName, stage || "development");
  }

  const result = await runHook(hooks.verify, input, { timeout: settings.hookTimeout ?? 180000 });

  if (!result.ok) {
    return { ok: false, issues: [`Verify hook failed: ${result.stderr}`] };
  }

  const output = result.data as unknown as VerifyHookOutput;

  if (output.status === "success") {
    log(`${phaseLabel("VERIFY")} hook ${taskId}: passed`);
    return { ok: true, issues: [] };
  }

  const issues = output.issues || ["Verify hook reported failure"];
  log(`${phaseLabel("VERIFY")} hook ${taskId}: ${issues.length} issues`);
  logDetail(issuesBlock(issues));
  return { ok: false, issues };
}

// ── Healthcheck Hook ──

export interface HealthcheckHookOptions {
  planFile: string;
  planName: string;
  stage: BuildStage;
  settings: Settings;
  cwd?: string;
}

export async function runHealthcheckHook(
  hooks: HookMap,
  opts: HealthcheckHookOptions,
): Promise<{ ok: boolean; issues: string[] }> {
  if (!hooks.healthcheck) return { ok: true, issues: [] };

  const { planFile, planName, stage, settings, cwd } = opts;
  log(`${phaseLabel("HEALTH")} hook`);

  const input: Record<string, unknown> = {
    build: buildBuildContext(planFile, planName, stage),
  };
  if (cwd) input.cwd = cwd;

  const result = await runHook(hooks.healthcheck, input, { timeout: settings.hookTimeout ?? 30000 });

  if (!result.ok) {
    return { ok: false, issues: [`Healthcheck hook failed: ${result.stderr}`] };
  }

  const output = result.data as unknown as HealthcheckHookOutput;
  if (output.status === "success") {
    log(`${phaseLabel("HEALTH")} hook: passed`);
    return { ok: true, issues: [] };
  }

  const issues = output.issues || ["Healthcheck reported failure"];
  log(`${phaseLabel("HEALTH")} hook: ${issues.length} issues`);
  logDetail(issuesBlock(issues));
  return { ok: false, issues };
}

// ── Review Session ──

export async function runReviewSession(
  hooks: HookMap,
  projectRoot: string,
  planFile: string,
  taskId: string,
  settings: Settings,
  planName: string,
  mode: ReviewMode = "full",
  cwd?: string,
  branch?: string,
  taskIds?: string[],
  seedSessionName?: string,
  priorIssues?: string[],
): Promise<{ ok: boolean; issues: string[]; structured: ReviewSessionOutput }> {
  const scopeLabel = taskIds ? `${taskIds.length} task(s)` : taskId;
  log(`${phaseLabel("REVIEW")} session: ${scopeLabel} (mode: ${mode})`);

  // Lifecycle hook: before-review
  const beforeReviewInput: Record<string, unknown> = { task_id: taskId };
  if (cwd) beforeReviewInput.cwd = cwd;
  if (branch) beforeReviewInput.branch = branch;
  if (planName) beforeReviewInput.build = buildBuildContext(planFile, planName, "validation");
  await tryHook(hooks, "before-review", beforeReviewInput, { timeout: settings.hookTimeout });

  const _label = sessionLabel(planName, taskId, "review");
  // Seed forking only works when running in projectRoot (same directory as
  // the seed). Worktree sessions (cwd is set) can't find the seed session.
  const canFork = seedSessionName && !cwd;
  const payloadObj: Record<string, unknown> = {
    plan_path: planFile,
    mode,
    ...(canFork && { context_preloaded: true }),
    ...(priorIssues?.length && { prior_issues: priorIssues }),
  };
  if (taskIds) {
    payloadObj.task_ids = taskIds;
  } else {
    payloadObj.task_id = taskId;
  }
  const payload = JSON.stringify(payloadObj);

  const forkArgs = canFork
    ? ["--resume", seedSessionName, "--fork-session"]
    : [];

  const result = await invokeClaude(
    cwd || projectRoot,
    [
      ...forkArgs,
      "--model",
      MODEL,
      "--allowedTools",
      "Read,Glob,Grep,Bash,Agent",
      "--max-turns",
      "30",
      "--max-budget-usd",
      BUDGET_AGENT,
      "--json-schema",
      JSON.stringify(REVIEW_SESSION_SCHEMA),
      `/molcajete:validate ${payload}`,
    ],
    "REVIEW",
  );

  const out = extractStructuredOutput(result.output) as unknown as ReviewSessionOutput;
  const allIssues = [...(out.code_review || []), ...(out.completeness || [])];

  // Lifecycle hook: after-review
  const afterReviewInput: Record<string, unknown> = { task_id: taskId, issues: allIssues };
  if (cwd) afterReviewInput.cwd = cwd;
  if (branch) afterReviewInput.branch = branch;
  if (planName) afterReviewInput.build = buildBuildContext(planFile, planName, "validation");
  await tryHook(hooks, "after-review", afterReviewInput, { timeout: settings.hookTimeout });

  if (allIssues.length === 0) {
    log(`${phaseLabel("REVIEW")} session ${taskId}: all clear`);
    return { ok: true, issues: [], structured: out };
  }

  log(`${phaseLabel("REVIEW")} session ${taskId}: ${allIssues.length} issues found`);
  logDetail(issuesBlock(allIssues));
  return { ok: false, issues: allIssues, structured: out };
}

// ── Review Fix Session ──

export async function runReviewFixSession(
  projectRoot: string,
  planFile: string,
  issues: string[],
  taskIds: string[],
  planName: string,
  cwd?: string,
  seedSessionName?: string,
): Promise<{ ok: boolean; structured: DevSessionOutput }> {
  log(`${phaseLabel("DEV")} review-fix session: ${taskIds.length} task(s), ${issues.length} issue(s)`);

  // Seed forking only works when running in projectRoot.
  const canFork = seedSessionName && !cwd;
  const payload = JSON.stringify({
    plan_path: planFile,
    task_ids: taskIds,
    issues,
    ...(canFork && { context_preloaded: true }),
  });

  const forkArgs = canFork
    ? ["--resume", seedSessionName, "--fork-session"]
    : [];

  const result = await invokeClaude(
    cwd || projectRoot,
    [
      ...forkArgs,
      "--model",
      MODEL,
      "--allowedTools",
      "Read,Write,Edit,Glob,Grep,Bash",
      "--max-turns",
      MAX_TURNS_AGENT,
      "--max-budget-usd",
      BUDGET_AGENT,
      "--json-schema",
      JSON.stringify(DEV_SESSION_SCHEMA),
      `/molcajete:review-fix ${payload}`,
    ],
    "DEV",
  );

  const out = extractStructuredOutput(result.output) as unknown as DevSessionOutput;

  if (result.exitCode === 0 && out.status === "done") {
    return { ok: true, structured: out };
  }

  const error = out.error || extractFailureReason(result.output, result.stderr) || "Review fix session failed";
  log(`${phaseLabel("DEV")} review-fix session: failed (${error})`);
  return { ok: false, structured: out };
}

// ── Recovery Session ──

export async function runRecoverySession(
  projectRoot: string,
  context: RecoveryContext,
): Promise<{ ok: boolean; structured: RecoverySessionOutput }> {
  const _label = sessionLabel(context.plan_name, context.failed_task_id, "recovery");
  log(`${phaseLabel("RECOVERY")} session: ${context.failed_task_id} (stage: ${context.failed_stage})`);

  const payload = JSON.stringify(context);

  const result = await invokeClaude(
    projectRoot,
    [
      "--model",
      MODEL,
      "--allowedTools",
      "Read,Write,Edit,Glob,Grep,Bash",
      "--max-turns",
      MAX_TURNS_AGENT,
      "--max-budget-usd",
      BUDGET_RECOVERY,
      "--json-schema",
      JSON.stringify(RECOVERY_SESSION_SCHEMA),
      `/molcajete:recover ${payload}`,
    ],
    "RECOVERY",
  );

  const out = extractStructuredOutput(result.output) as unknown as RecoverySessionOutput;

  if (result.exitCode === 0 && out.status === "recovered") {
    log(`${phaseLabel("RECOVERY")} session ${context.failed_task_id}: recovered — ${out.summary}`);
    return { ok: true, structured: out };
  }

  // Build a detailed error from structured output, result event, or stderr.
  const failureReason = extractFailureReason(result.output, result.stderr);
  const error = out.error || failureReason || "Recovery session failed";

  // Surface all available diagnostic info as issues.
  const issues: string[] = [];
  const stderrDetail = result.stderr.trim();
  if (!out.status) {
    // Session produced no structured output — likely crashed or the command wasn't found.
    const detail = stderrDetail
      ? stderrDetail.split("\n").pop()
      : failureReason || `exit code ${result.exitCode}, no output`;
    issues.push(`Recovery session exited without result: ${detail}`);
  } else {
    issues.push(error);
  }
  if (result.exitCode !== 0) {
    issues.push(`Exit code: ${result.exitCode}`);
  }

  log(`${phaseLabel("RECOVERY")} session ${context.failed_task_id}: failed (${error})`);
  logDetail(issuesBlock(issues));

  // Ensure the structured output carries the error for callers.
  if (!out.error) out.error = error;
  return { ok: false, structured: out };
}

// ── Doc Session ──

export async function runDocSession(
  projectRoot: string,
  planFile: string,
  task: Task,
  devSummary: string,
  filesModified: string[],
  planName: string,
  cwd?: string,
): Promise<{ ok: boolean; structured: DocSessionOutput }> {
  const taskId = task.id;
  const _label = sessionLabel(planName, taskId, "doc");
  log(`${phaseLabel("DOC")} session: ${taskId}`);

  const payload = JSON.stringify({
    plan_path: planFile,
    task_id: taskId,
    intent: task.intent,
    files_modified: filesModified,
    dev_summary: devSummary,
  });

  const result = await invokeClaude(
    cwd || projectRoot,
    [
      "--model",
      MODEL,
      "--max-turns",
      "30",
      "--allowedTools",
      "Read,Write,Edit,Glob,Grep,Bash,Agent",
      "--json-schema",
      JSON.stringify(DOC_SESSION_SCHEMA),
      `/molcajete:document ${payload}`,
    ],
    "DOC",
  );

  const out = extractStructuredOutput(result.output) as unknown as DocSessionOutput;

  if (result.exitCode === 0 && out.status === "done") {
    log(`${phaseLabel("DOC")} session ${taskId}: ${(out.files_modified || []).length} file(s) updated`);
    return { ok: true, structured: out };
  }

  const error = out.error || extractFailureReason(result.output, result.stderr) || "Doc session failed";
  log(`${phaseLabel("DOC")} session ${taskId}: warning — ${error}`);
  return { ok: false, structured: out };
}

// ── Doc Commit ──

export async function commitDocChanges(
  taskId: string,
  docFiles: string[],
  cwd?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!docFiles || docFiles.length === 0) return { ok: true };

  try {
    for (const f of docFiles) {
      execSync(`git add "${f}"`, { stdio: "pipe", ...(cwd && { cwd }) });
    }

    try {
      execSync("git diff --cached --quiet", { stdio: "pipe", ...(cwd && { cwd }) });
      logDetail(`Doc commit ${taskId}: no changes to commit`);
      return { ok: true };
    } catch {
      // There are staged changes — proceed
    }

    execSync(`git commit -m "docs: update documentation for ${taskId}"`, { stdio: "pipe", ...(cwd && { cwd }) });
    logDetail(`Doc commit ${taskId}: committed`);
    return { ok: true };
  } catch (err) {
    logDetail(`Doc commit ${taskId}: warning — ${(err as Error).message}`);
    return { ok: false, error: (err as Error).message };
  }
}
