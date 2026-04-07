/**
 * -- After Subtask Hook --
 *
 * Fires after a sub-task completes. Use it for per-subtask reporting
 * or to clean up subtask-specific state.
 *
 * -- When it fires --
 * After the sub-task is marked implemented or failed, before the next sub-task.
 *
 * -- Input (ctx.input) --
 * @property {string} task_id      - Parent task ID ("TASK-0A1B")
 * @property {string} subtask_id   - Sub-task ID ("TASK-0A1B-1")
 * @property {string} [feature_id] - Associated feature
 * @property {string} [usecase_id] - Associated use case
 * @property {string} [scenario_id]- Associated scenario
 * @property {string} [status]     - Sub-task outcome: "implemented" or "failed"
 * @property {string} [cwd]        - Worktree working directory
 * @property {string} [branch]     - Worktree branch name
 * @property {object} [build]      - BuildContext
 *
 * -- Expected output --
 * @returns {{ status: 'ok' }}
 */

/** @typedef {import('@molcajeteai/cli').HookContext} HookContext */
/** @typedef {import('@molcajeteai/cli').SubtaskLifecycleInput} SubtaskLifecycleInput */
/** @typedef {import('@molcajeteai/cli').LifecycleOutput} LifecycleOutput */

/** @param {HookContext<SubtaskLifecycleInput>} ctx */
export default async function afterSubtask(ctx) {
  return { status: 'ok' };
}
