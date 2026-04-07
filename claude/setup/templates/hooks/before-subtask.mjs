/**
 * -- Before Subtask Hook --
 *
 * Fires before a sub-task begins. Useful for granular tracking or
 * preparing sub-task-specific fixtures.
 *
 * -- When it fires --
 * After the sub-task is marked in_progress but before its dev session.
 *
 * -- Input (ctx.input) --
 * @property {string} task_id      - Parent task ID ("TASK-0A1B")
 * @property {string} subtask_id   - Sub-task ID ("TASK-0A1B-1")
 * @property {string} [feature_id] - Associated feature
 * @property {string} [usecase_id] - Associated use case
 * @property {string} [scenario_id]- Associated scenario
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
export default async function beforeSubtask(ctx) {
  return { status: 'ok' };
}
