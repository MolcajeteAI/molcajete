/**
 * -- After Task Hook --
 *
 * Fires after a task completes (success or failure). Use it to send
 * notifications, update dashboards, or clean up task-specific resources.
 *
 * -- When it fires --
 * After the task is marked implemented or failed, before the next task.
 *
 * -- Input (ctx.input) --
 * @property {string} task_id      - Task ID ("TASK-0A1B")
 * @property {string} [feature_id] - Associated feature
 * @property {string} [usecase_id] - Associated use case
 * @property {string} [scenario_id]- Associated scenario
 * @property {string} [status]     - Task outcome: "implemented" or "failed"
 * @property {string} [summary]    - Dev session summary
 * @property {string} [cwd]        - Worktree working directory
 * @property {string} [branch]     - Worktree branch name
 * @property {object} [build]      - BuildContext
 *
 * -- Expected output --
 * @returns {{ status: 'ok' }}
 */

/** @typedef {import('@molcajeteai/cli').HookContext} HookContext */
/** @typedef {import('@molcajeteai/cli').TaskLifecycleInput} TaskLifecycleInput */
/** @typedef {import('@molcajeteai/cli').LifecycleOutput} LifecycleOutput */

/** @param {HookContext<TaskLifecycleInput>} ctx */
export default async function afterTask(ctx) {
  return { status: 'ok' };
}
